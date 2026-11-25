import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const sdkUrl = 'https://res.wx.qq.com/open/js/jweixin-1.6.0.js';
const sdkDigest = '0f17c4f7daf51a49a9627714ad2da6c037352442699ba8ceca68b7c6dc0b1dba';
const apiOrigin = 'https://api.weixin.qq.com';

export function wechatShareConfig(value, configPath) {
  if (value === undefined) return;
  if (!value || !/^wx[a-f0-9]{16}$/i.test(value.appId ?? '') ||
      !/^[a-z0-9][a-z0-9._-]*$/i.test(value.appSecretFile ?? ''))
    throw new Error('Configure wechatShare.appId and a private appSecretFile beside service.json');
  const secretPath = resolve(dirname(configPath), value.appSecretFile);
  const stat = lstatSync(secretPath, { throwIfNoEntry: false });
  if (!stat?.isFile() || (stat.mode & 0o077)) throw new Error('WeChat AppSecret file must be private (0600)');
  const appSecret = readFileSync(secretPath, 'utf8').trim();
  if (!/^[a-f0-9]{32}$/i.test(appSecret)) throw new Error('Invalid WeChat AppSecret format');
  return { appId: value.appId, appSecret };
}

export function wechatSignature(ticket, nonceStr, timestamp, url) {
  return createHash('sha1').update(`jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`).digest('hex');
}

export function createWechatShare(config, { fetcher = fetch, now = Date.now } = {}) {
  if (!config) return;
  const { appId, appSecret } = config;
  const unavailable = () => new Error('WeChat sharing is temporarily unavailable');
  const retrieve = async (url, init) => {
    try {
      const response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(6000) });
      if (response.ok) return response;
      await response.body?.cancel();
    } catch {
      // Provider URLs and errors may contain credentials.
    }
    throw unavailable();
  };
  let cachedTicket, ticketPending, retryAt = 0, sdkPending;
  async function fetchTicket() {
    const token = await (await retrieve(apiOrigin + '/cgi-bin/stable_token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credential', appid: appId, secret: appSecret, force_refresh: false }),
    })).json();
    if (typeof token.access_token !== 'string' || !token.access_token || token.errcode) throw unavailable();
    const query = new URLSearchParams({ access_token: token.access_token, type: 'jsapi' });
    const answer = await (await retrieve(apiOrigin + '/cgi-bin/ticket/getticket?' + query)).json();
    if (answer.errcode || typeof answer.ticket !== 'string' || !answer.ticket || !Number.isFinite(answer.expires_in) ||
        answer.expires_in <= 60) throw unavailable();
    cachedTicket = { value: answer.ticket, until: now() + (answer.expires_in - 60) * 1000 };
    return cachedTicket.value;
  }
  function ticket() {
    if (cachedTicket?.until > now()) return cachedTicket.value;
    if (now() < retryAt) throw unavailable();
    ticketPending ??= fetchTicket().catch(() => {
      retryAt = now() + 10000;
      throw unavailable();
    }).finally(() => { ticketPending = undefined; });
    return ticketPending;
  }
  return {
    async sign(url) {
      const value = await ticket();
      const nonceStr = randomBytes(16).toString('hex');
      const timestamp = Math.floor(now() / 1000);
      return { appId, nonceStr, timestamp, signature: wechatSignature(value, nonceStr, timestamp, url) };
    },
    sdk() {
      // Keep the reviewed vendor script immutable and serve it under our existing CSP.
      sdkPending ??= retrieve(sdkUrl).then(async response => {
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.byteLength;
          if (size > 64 * 1024) throw unavailable();
          chunks.push(chunk);
        }
        const source = Buffer.concat(chunks);
        if (createHash('sha256').update(source).digest('hex') !== sdkDigest) throw unavailable();
        return source;
      }).catch(() => {
        sdkPending = undefined;
        throw unavailable();
      });
      return sdkPending;
    },
  };
}
