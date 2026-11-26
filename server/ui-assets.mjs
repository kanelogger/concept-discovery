import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';

const defaultRoot = fileURLToPath(new URL('../web/generated/', import.meta.url));
const types = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
const programPath = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.(?:js|css|woff2?|ttf)$/;
const hashSuffix = /-[A-Z2-7]{8}\.[a-z0-9]+$/;
const variants = [
  { coding: 'br', suffix: '.br', decode: brotliDecompressSync },
  { coding: 'gzip', suffix: '.gz', decode: gunzipSync },
];

function readReleaseFile(root, path) {
  const target = resolve(root, path);
  if (realpathSync(target) !== target) throw new Error('UI release contains a symbolic link');
  const fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) throw new Error('Expected a regular UI release file');
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

function loadRelease(root, allowMissingManifest = false) {
  let manifestBytes;
  try {
    root = realpathSync(root);
    manifestBytes = readReleaseFile(root, 'manifest.json');
  } catch (error) {
    if (allowMissingManifest && error.code === 'ENOENT') return null;
    throw error;
  }
  const { schema, entry, assets, staticStyles } = JSON.parse(manifestBytes);
  if (![1, 2].includes(schema) || !Array.isArray(assets)) throw new Error('Invalid UI manifest');
  const files = new Map();
  for (const { path, sha256, encodings } of assets) {
    if (typeof path !== 'string' || !programPath.test(path) || files.has(path)) throw new Error('Invalid UI manifest path');
    const content = readReleaseFile(root, path);
    if (createHash('sha256').update(content).digest('hex') !== sha256) throw new Error('UI asset does not match its manifest: ' + path);
    const bodies = new Map([['identity', content]]);
    if (schema === 2 && Array.isArray(encodings)) {
      for (const { coding, suffix, decode } of variants) {
        if (!encodings.includes(coding)) continue;
        try {
          const bytes = readReleaseFile(root, path + suffix);
          if (decode(bytes, { maxOutputLength: Math.max(1, content.length) }).equals(content)) bodies.set(coding, bytes);
        } catch {
          // A missing or broken optional representation can fall back to another encoding.
        }
      }
    }
    files.set(path, { type: types[extname(path)], immutable: schema === 2 && hashSuffix.test(path), bodies });
  }
  if (!files.has(entry?.js) || extname(entry.js) !== '.js' || !Array.isArray(entry.css) ||
      !entry.css.every(path => files.has(path) && extname(path) === '.css')) throw new Error('Invalid UI manifest entry');
  const tags = [...entry.css.map(path => '<link rel="stylesheet" href="/ui/' + path + '">'),
    '<script type="module" src="/ui/' + entry.js + '"></script>'];
  files.set('manifest.json', { type: 'application/json; charset=utf-8', immutable: false, bodies: new Map([['identity', manifestBytes]]) });
  return { files, legacyStyleNonce: staticStyles !== true, entryHTML: tags.join('\n    ') };
}

function chooseEncoding(bodies, header) {
  const weights = new Map();
  for (const field of (header ?? '').toLowerCase().split(',')) {
    const [name, ...parameters] = field.trim().split(/\s*;\s*/);
    if (!['br', 'gzip', 'identity', '*'].includes(name)) continue;
    const weight = /^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.exec(parameters.join(';'));
    const quality = parameters.length ? Number(weight?.[1] ?? 0) : 1;
    weights.set(name, Math.min(weights.get(name) ?? 1, quality));
  }
  let best;
  let bestQuality = 0;
  for (const name of ['br', 'gzip', 'identity']) {
    if (!bodies.has(name)) continue;
    const quality = weights.get(name) ?? (name === 'identity' ? 0 : weights.get('*') ?? 0);
    if (quality > bestQuality) {
      best = name;
      bestQuality = quality;
    }
  }
  if (best) return best;
  // Unlisted identity is the fallback, unless an explicit exclusion also covers it.
  if ((weights.get('identity') ?? weights.get('*')) !== 0) return 'identity';
  return null;
}

export function loadUIAssets({ uiAssetRoot, previousUIAssetRoot, requireUIAssets = false } = {}) {
  const current = loadRelease(uiAssetRoot ?? defaultRoot, !requireUIAssets && uiAssetRoot === undefined);
  let previous;
  if (previousUIAssetRoot) {
    try {
      previous = loadRelease(previousUIAssetRoot);
    } catch {
      process.emitWarning('Previous UI release unavailable. Check its directory, manifest and asset digests.');
    }
  }
  return {
    entryHTML: current?.entryHTML ?? '',
    legacyStyleNonce: current?.legacyStyleNonce ?? false,
    read(path, acceptEncoding) {
      const file = current?.files.get(path) ?? (path !== 'manifest.json' && previous?.files.get(path));
      if (!file) return null;
      const encoding = chooseEncoding(file.bodies, acceptEncoding);
      if (!encoding) return { status: 406 };
      return { status: 200, type: file.type, immutable: file.immutable, encoding, content: file.bodies.get(encoding) };
    },
  };
}
