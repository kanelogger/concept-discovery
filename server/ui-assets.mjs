import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('../web/generated/', import.meta.url));
const types = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
export function readUIAsset(path, root = defaultRoot) {
  if (!path || /[%\\\0]/.test(path) || path.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  const manifestBytes = readFileSync(resolve(root, 'manifest.json'));
  if (path === 'manifest.json') return { type: 'application/json; charset=utf-8', content: manifestBytes };
  const manifest = JSON.parse(manifestBytes);
  if (!types[extname(path)] || !manifest.assets.some((asset) => asset.path === path)) return null;
  const target = resolve(root, path);
  if (lstatSync(target).isSymbolicLink()) return null;
  const local = relative(realpathSync(root), realpathSync(target));
  if (isAbsolute(local) || local === '..' || local.startsWith('../')) return null;
  return { type: types[extname(path)], content: readFileSync(target) };
}
