import { readFileSync } from 'node:fs';

export const defaultCover = '/share-cover.png';
const materials = new URL('./share-materials/', import.meta.url);
const rawIdentity = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function shareMaterialReader(root) {
  return ({ rawId, title }) => {
    const fallback = { title: [...title].slice(0, 64).join(''), description: '' };
    if (typeof rawId !== 'string' || !rawIdentity.test(rawId)) return fallback;
    let catalog;
    try { catalog = JSON.parse(readFileSync(new URL('catalog.json', root), 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return fallback;
      throw error;
    }
    const material = Object.hasOwn(catalog, rawId) ? catalog[rawId] : undefined;
    if (!material || material.id !== rawId || material.cardTitle !== title) return fallback;
    return { title: material.title, description: material.description, cover: new URL(`covers/${rawId}.png`, root) };
  };
}

export const getShareMaterial = shareMaterialReader(materials);

export const readShareCover = cover => cover ? { type: 'image/png', bytes: readFileSync(cover) } : null;

export function describePreview(preview, origin) {
  return {
    id: preview.id, version: preview.version, title: preview.title, description: preview.description,
    image: origin + (preview.coverType ? `/share/${preview.id}/cover?v=${preview.version}` : defaultCover),
  };
}

const escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function shareHead(preview) {
  const meta = (key, value) => `    <meta property="og:${key}" content="${escapeHtml(value)}">`;
  return [
    `<title>${escapeHtml(preview.title)}</title>`,
    meta('type', 'website'),
    meta('title', preview.title),
    meta('description', preview.description),
    meta('image', preview.image),
  ].join('\n');
}
