import { parseFragment, serialize } from 'parse5';
import { cardScope } from '../lib/library-scope.mjs';
import { fail, quote } from '../lib/siyuan.mjs';
import { readSession } from './auth-http.mjs';
import { renderMarkdown, validBlockID } from './render.mjs';
import { validPreviewId, validShareToken } from './card-share-store.mjs';
import { defaultCover, describePreview, readShareCover } from './card-share-preview.mjs';

const imageLimit = 6 * 1024 * 1024;
const htmlLimit = 1024 * 1024;
const invalidLink = '此分享链接无效或已撤销。';
const rasterHeaders = {
  'image/avif': bytes => bytes.toString('ascii', 4, 8) === 'ftyp' && /^(avif|avis)$/.test(bytes.toString('ascii', 8, 12)),
  'image/gif': bytes => /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6)),
  'image/jpeg': bytes => bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
  'image/png': bytes => bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
  'image/webp': bytes => bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP',
};

function absoluteWebLink(value, origin) {
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
        url.hostname !== new URL(origin).hostname) return url.href;
  } catch {
    // Private, relative and malformed links keep only their visible text.
  }
}

async function imageData(response, limit) {
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!response.ok || !Object.hasOwn(rasterHeaders, type) || !response.body || Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    return null;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  if (!rasterHeaders[type](buffer)) return null;
  return { size, url: `data:${type};base64,${buffer.toString('base64')}` };
}

async function snapshot(card, origin, readAsset) {
  const html = renderMarkdown(card.markdown, { legacyFixedFields: card.legacyFixedFields });
  if (Buffer.byteLength(html) > htmlLimit) fail('input_too_large', '卡片正文过大，无法创建分享链接。');
  const tree = parseFragment(html);
  const images = new Map();
  const signal = AbortSignal.timeout(30000);
  let remaining = imageLimit;
  const find = (node, key) => node.attrs.find(attr => attr.name === key);
  async function visit(node) {
    if (node.tagName === 'a') {
      const href = find(node, 'href');
      const destination = absoluteWebLink(href?.value, origin);
      if (destination) href.value = destination;
      else {
        node.nodeName = node.tagName = 'span';
        node.attrs = [];
      }
    }
    if (node.tagName === 'img') {
      const src = find(node, 'src');
      const path = src?.value;
      if (path?.startsWith('/assets/') && remaining > 0 && images.size < 48 && !images.has(path)) {
        let image;
        try { image = await imageData(await readAsset(path, signal), remaining); }
        catch (error) { if (error.code !== 'outside_scope') throw error; }
        images.set(path, image ?? null);
      }
      const data = images.get(path);
      if (data && data.size <= remaining) {
        src.value = data.url;
        remaining -= data.size;
      } else {
        // Keep readable alt text in the snapshot without fetching remote images.
        const text = find(node, 'alt')?.value || '图片未包含在分享中';
        return { nodeName: '#text', value: text, parentNode: node.parentNode };
      }
    }
    for (const [index, child] of node.childNodes?.entries() ?? []) node.childNodes[index] = await visit(child);
    return node;
  }
  await visit(tree);
  return { title: card.title, html: serialize(tree) };
}

const previewIdFrom = path => /^\/share\/([a-f0-9]{32})$/.exec(path)?.[1];
const coverIdFrom = path => /^\/share\/([a-f0-9]{32})\/cover$/.exec(path)?.[1];
const sharePath = preview => preview ? '/share/' + preview.id : '/share';
const sdkPath = '/share/wechat-sdk.js';
const shareRead = '/api/card-share/read';
const shareSign = '/api/card-share/wechat-config';
export const isSharePage = path => path === '/share' || Boolean(previewIdFrom(path));
export const isShareResource = path => Boolean(coverIdFrom(path)) || path === sdkPath;

function signatureUrl(value, origin, expectedPath) {
  if (typeof value !== 'string' || value.length > 4096 || value.includes('#')) return;
  try {
    const url = new URL(value);
    if (url.href === value && url.origin === origin && !url.username && !url.password && url.pathname === expectedPath) return value;
  } catch {
    // The browser must send its serialized HTTPS entry URL.
  }
}

export function cardShareRoutes({ api, activeMain, authStore, dispatch, origin, json, readAsset, send, wechatShare, getShareMaterial }) {
  const shares = authStore?.shares;
  const toUrl = (token, preview) => `${origin}${sharePath(preview)}#${token}`;
  const describe = preview => preview ? describePreview(preview, origin) : null;
  const cardInfo = async id => {
    if (activeMain) {
      const info = await activeMain(id);
      return info && !shares?.fencedForDeletion(info.id) ? info : null;
    }
    const rows = await api.sql(`SELECT b.id, b.content AS title,
      (SELECT value FROM attributes WHERE block_id = b.id AND name = 'custom-cd-legacy-id' LIMIT 1) AS rawId
      FROM blocks b WHERE b.id = ${quote(id)} AND ${cardScope(api.c)}
      AND NOT EXISTS (SELECT 1 FROM attributes parent WHERE parent.block_id = b.id
        AND parent.name = 'custom-cd-parent' AND parent.value <> '')`, { signal: AbortSignal.timeout(5000) });
    return rows[0];
  };
  const publicActive = async id => {
    const info = await cardInfo(id).catch(() => fail('share_unavailable', '暂时无法读取分享。'));
    return info?.id === id;
  };
  async function managed(id, token) {
    const preview = token ? shares.previewFor(token) : null;
    const info = preview ? null : await cardInfo(id);
    const material = info ? getShareMaterial(info) : null;
    return {
      url: token ? toUrl(token, preview) : null, preview: describe(preview),
      suggestion: material && {
        title: material.title, description: material.description,
        image: material.cover ? `/api/card-shares/${id}/suggested-cover` : defaultCover,
      },
    };
  }
  function withCover(material) {
    return { ...material, cover: readShareCover(material.cover) };
  }

  async function publicPreview(id) {
    const preview = shares?.previewById(id);
    if (!preview || !await publicActive(preview.cardId)) return;
    return shares.previewById(id);
  }
  function boundPreview(token, id) {
    const preview = shares.previewFor(token);
    if (id !== undefined && (!validPreviewId(id) || preview?.id !== id)) fail('not_found', invalidLink);
    return preview;
  }
  async function scope(token, id) {
    const cardId = shares.cardFor(token);
    if (!cardId || !await publicActive(cardId) || !shares.cardFor(token)) fail('not_found', invalidLink);
    return boundPreview(token, id);
  }
  async function pagePreview(path) {
    const id = previewIdFrom(path);
    return id ? describe(await publicPreview(id)) : null;
  }

  async function handle({ req, res, path }) {
    if (!shares) return false;
    if ((req.method === 'GET' || req.method === 'HEAD') && isShareResource(path)) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      if (path === sdkPath) {
        if (!wechatShare) fail('not_found', '微信分享服务未开启。');
        const source = await wechatShare.sdk().catch(() => fail('share_unavailable', '微信分享服务暂不可用。'));
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.end(source);
        return true;
      }
      const id = coverIdFrom(path);
      if (!await publicPreview(id)) fail('not_found', invalidLink);
      const file = shares.coverById(id);
      if (!file?.cover) fail('not_found', '分享封面不存在。');
      res.setHeader('Content-Type', file.type);
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.end(file.cover);
      return true;
    }
    const management = /^\/api\/card-shares\/([^/]+)(\/suggested-cover)?$/.exec(path);
    const publicCall = (path === shareRead || path === shareSign) && req.method === 'POST';
    if (!management && !publicCall) return false;
    const body = async () => {
      if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers['content-type'] ?? ''))
        fail('invalid_input', '需要 JSON 请求。');
      return json(req, 8192);
    };
    if (publicCall) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      const { token, previewId, url } = await body();
      const preview = await scope(token, previewId);
      if (path === shareSign) {
        if (!wechatShare || !preview) fail('not_found', '微信分享服务未开启。');
        const page = signatureUrl(url, origin, previewId === undefined ? '/share' : sharePath(preview));
        if (!page) fail('invalid_input', '微信分享页面地址不匹配。');
        const signature = await wechatShare.sign(page).catch(() => fail('share_unavailable', '微信分享服务暂不可用。'));
        const current = await scope(token, preview.id);
        send(res, 200, { ok: true, data: {
          signature, url: toUrl(token, current), preview: describe(current),
        } });
      } else {
        const content = shares.contentFor(token);
        if (!content) fail('not_found', invalidLink);
        send(res, 200, { ok: true, data: {
          ...JSON.parse(content), ...(preview && { preview: describe(preview), wechat: Boolean(wechatShare) }),
        } });
      }
      return true;
    }

    const requireOwner = () => {
      if (!readSession(req, authStore)) fail('unauthorized', '请登录后管理分享链接。');
    };
    requireOwner();
    const [, ref, suggestedCover] = management;
    let id = ref;
    if (activeMain) {
      let decoded;
      try { decoded = decodeURIComponent(ref); }
      catch { fail('invalid_input', '需要有效的知识卡 ID。'); }
      const info = await cardInfo(decoded);
      if (info) id = info.id;
      else if (req.method === 'DELETE' && !suggestedCover && shares.hasCard(decoded)) id = decoded;
      else fail('not_found', '知识卡不存在或已归档。');
    } else if (!validBlockID(id)) fail('invalid_input', '需要有效的知识卡 ID。');
    if (suggestedCover) {
      if (req.method !== 'GET') return false;
      const info = await cardInfo(id);
      requireOwner();
      const file = info && readShareCover(getShareMaterial(info).cover);
      if (!file) fail('not_found', '分享封面不存在。');
      res.setHeader('Content-Type', file.type);
      res.end(file.bytes);
      return true;
    }
    if (req.method === 'GET') {
      const data = await managed(id, shares.state(id).token);
      requireOwner();
      send(res, 200, { ok: true, data });
    } else if (req.method === 'PUT') {
      let { token, generation } = shares.state(id);
      if (!token) {
        const info = await cardInfo(id);
        if (!info) fail('not_found', '知识卡不存在或已归档。');
        const card = await dispatch('get-document', { id }, { publicUrl: origin });
        if (card.id !== id || card.anchor) fail('not_found', '知识卡不存在或已归档。');
        const content = await snapshot(card, origin, readAsset);
        if (res.destroyed) return true;
        if (activeMain && (await cardInfo(id))?.id !== id) fail('not_found', '知识卡不存在或已归档。');
        requireOwner();
        token = shares.createWithPreview(id, generation, content, withCover(getShareMaterial({ ...info, title: card.title })));
        if (!token) fail('share_conflict', '分享链接已变更，请重新打开分享面板。');
      }
      const data = await managed(id, token);
      requireOwner();
      send(res, 200, { ok: true, data });
    } else if (req.method === 'PATCH') {
      const input = await body();
      if (!validShareToken(input.token) || !Number.isSafeInteger(input.version) || input.version < 0)
        fail('invalid_input', '分享链接或样式版本无效。');
      const info = await cardInfo(id);
      if (!info) fail('not_found', '知识卡不存在或已归档。');
      requireOwner();
      if (!shares.savePreview(id, input.token, input.version, withCover(getShareMaterial(info))))
        fail('share_conflict', '分享样式已变更，请重新打开分享面板。');
      send(res, 200, { ok: true, data: await managed(id, input.token) });
    } else if (req.method === 'DELETE') {
      const { token } = await body();
      if (!validShareToken(token)) fail('invalid_input', '分享链接无效。');
      requireOwner();
      if (!shares.revoke(id, token) && shares.state(id).token) fail('share_conflict', '分享链接已变更，请重新打开分享面板。');
      const data = await managed(id, null).catch(() => ({ url: null, preview: null, suggestion: null }));
      send(res, 200, { ok: true, data });
    } else {
      return false;
    }
    return true;
  }
  return { handle, pagePreview, cardInfo };
}
