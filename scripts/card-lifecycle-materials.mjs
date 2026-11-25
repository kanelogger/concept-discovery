import { lstatSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { canonical, fail, hash, save } from '../lib/siyuan.mjs';

function file(path, type) {
  const entry = lstatSync(path, {throwIfNoEntry:false});
  if (!entry) return null;
  if (type === 'directory' ? !entry.isDirectory() : !entry.isFile())
    fail('outside_scope', '分享素材路径不是普通文件或目录。');
  return path;
}

export function inspectShareMaterials(root, rawId) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rawId ?? '')) fail('invalid_input', '分享素材标识无效。');
  if (!file(root, 'directory')) return {catalog:null, cover:null, fingerprint:{entry:null,cover:null}};
  const catalogPath = join(root, 'catalog.json');
  const catalog = file(catalogPath) ? JSON.parse(readFileSync(catalogPath, 'utf8')) : null;
  if (catalog !== null && (typeof catalog !== 'object' || Array.isArray(catalog)))
    fail('content_conflict', '分享素材目录格式无效。');
  const covers = file(join(root, 'covers'), 'directory');
  const cover = covers && file(join(covers, rawId + '.png'));
  const entry = catalog && Object.hasOwn(catalog, rawId) ? catalog[rawId] : null;
  if (entry !== null && entry?.id !== rawId) fail('content_conflict', '分享素材归属不明确。');
  return { catalog, cover, fingerprint:{entry:entry && hash(canonical(entry)), cover:cover && hash(readFileSync(cover))} };
}

export function stageShareRemoval(tree, rawId, expected) {
  const folder = 'server/share-materials';
  const actual = inspectShareMaterials(join(tree, folder), rawId);
  if (JSON.stringify(actual.fingerprint) !== JSON.stringify(expected))
    fail('content_conflict', 'Git 分享素材在确认后已变化。');
  const patch = new Map();
  if (actual.fingerprint.entry) {
    delete actual.catalog[rawId];
    patch.set(folder + '/catalog.json', Buffer.from(JSON.stringify(actual.catalog, null, 2) + '\n'));
  }
  if (actual.cover) patch.set(folder + '/covers/' + rawId + '.png', null);
  return patch;
}

export function removeRuntimeShareMaterials(root, rawId, expected) {
  const current = inspectShareMaterials(root, rawId);
  for (const key of ['entry','cover']) {
    if (current.fingerprint[key] && current.fingerprint[key] !== expected[key])
      fail('content_conflict', '线上分享素材在确认后已变化。');
  }
  if (current.fingerprint.entry) {
    delete current.catalog[rawId];
    save(join(root,'catalog.json'), current.catalog);
  }
  if (current.cover) unlinkSync(current.cover);
  const after = inspectShareMaterials(root, rawId);
  if (after.fingerprint.entry || after.cover) fail('operation_pending', '分享素材还未完成读回。');
}
