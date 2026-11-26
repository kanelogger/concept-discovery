import { isIP } from 'node:net';
import { fail } from '../lib/read-contract.mjs';

export const isReadingPage = (path) => ['/', '/wiki', '/scenarios', '/graph', '/archives'].includes(path) || /^\/cards(?:\/[^/]+(?:\/edit)?)?$/.test(path);

export function safeReadingTarget(value, origin) {
  if (typeof value !== 'string' || value.length > 4096 || !value.startsWith('/') || value.startsWith('//') || /[\\\x00-\x1f\x7f#]/.test(value)) return '/cards';
  const target = new URL(value, origin);
  const path = target.pathname;
  if (target.origin !== origin || !isReadingPage(path) || /%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(path)) return '/cards';
  return path + target.search;
}

export const loginLocation = (target) => `/login?${new URLSearchParams({ next: target })}`;

const sessionCookie = '__Host-cd-session';
function sessionToken(req) {
  const prefix = `${sessionCookie}=`;
  const matches = (req.headers.cookie ?? '').split(';').map(item => item.trim()).filter(item => item.startsWith(prefix));
  if (matches.length === 1) return matches[0].slice(prefix.length);
}

export function readSession(req, store) {
  const token = sessionToken(req);
  if (token) {
    try { return store.session(token); }
    catch { fail('auth_unavailable', '暂时无法验证登录状态，请稍后重试。'); }
  }
}

function clientAddress(req, trustedProxyAddress) {
  const remote = req.socket.remoteAddress?.replace(/^::ffff:/, '');
  const forwarded = req.headers['x-concept-client-ip'];
  if (trustedProxyAddress && remote === trustedProxyAddress.replace(/^::ffff:/, '') && typeof forwarded === 'string' && isIP(forwarded)) return forwarded;
  return remote ?? 'unknown';
}

export function confirmSessionPassword(req, store, { publicId, password, trustedProxyAddress }) {
  return store.verifySessionPassword({ token:sessionToken(req), publicId, password, source:clientAddress(req, trustedProxyAddress) });
}

const errors = {
  invalid_credentials: [401, '用户名或密码不正确。'],
  rate_limited: [429, '尝试次数过多，请稍后再试。'],
};

export async function sessionEndpoint({ req, res, path, origin, originCheck, json, send, store, trustedProxyAddress }) {
  if (req.method === 'GET' && path === '/api/session') {
    const session = readSession(req, store);
    if (!session) fail('unauthorized', '请登录后继续。');
    send(res, 200, { ok: true, data: session });
    return true;
  }
  if (req.method !== 'POST' || !['/api/session/login', '/api/session/logout'].includes(path)) return false;
  originCheck(req);
  if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers['content-type'] ?? '')) fail('invalid_input', '需要 JSON 请求。');
  const body = await json(req, 8192);
  try {
    const source = clientAddress(req, trustedProxyAddress);
    if (path === '/api/session/login') {
      if (typeof body.username !== 'string' || typeof body.password !== 'string') fail('invalid_input', '请输入用户名和密码。');
      const target = safeReadingTarget(body.target, origin);
      const result = await store.login({ username: body.username, password: body.password, target, source });
      res.setHeader('Set-Cookie', `${sessionCookie}=${result.token}; Max-Age=86400; Path=/; Secure; HttpOnly; SameSite=Lax`);
      send(res, 200, { ok: true, data: { publicId: result.publicId, expiresAt: result.expiresAt, target: result.target } });
    } else {
      const token = sessionToken(req);
      const current = typeof body.publicId === 'string' && token ? store.session(token) : null;
      if (current && current.publicId !== body.publicId) {
        res.writeHead(204).end();
        return true;
      }
      if (token) store.logout(token);
      // A delayed response must not delete a newer login set by another tab.
      res.writeHead(204).end();
    }
  } catch (error) {
    const publicError = Object.hasOwn(errors, error.code) ? errors[error.code] : null;
    if (!publicError) {
      if (error.code === 'invalid_input') throw error;
      fail('auth_unavailable', '暂时无法验证登录状态，请稍后重试。');
    }
    const [status, message] = publicError;
    if (status === 429 && Number.isFinite(error.retryAfter)) res.setHeader('Retry-After', String(Math.max(1, Math.ceil(error.retryAfter))));
    send(res, status, { ok: false, error: { code: error.code, message } });
  }
  return true;
}
