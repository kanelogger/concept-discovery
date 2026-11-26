import { build } from 'esbuild';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'web/generated');
// A lazy page exports the URL of its stylesheet. Bundle its @imports before
// fingerprinting it so an already-open tab keeps the matching CSS after a release.
const routeStyles = {
  name: 'route-styles',
  setup(builder) {
    builder.onResolve({ filter: /\.css\?route$/ }, args => ({
      path: relative(root, resolve(args.resolveDir, args.path.slice(0, -'?route'.length))).split('\\').join('/'), namespace: 'route-style',
    }));
    builder.onLoad({ filter: /.*/, namespace: 'route-style' }, async ({path}) => {
      const css = await build({ absWorkingDir: root, entryPoints: [path], bundle: true, minify: true,
        charset: 'utf8', target: 'es2022', write: false, legalComments: 'eof' });
      return { contents: css.outputFiles[0].contents, loader: 'file' };
    });
  },
};
async function buildBundle(directory) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: { app: 'web/app.jsx', theme: 'web/style.css' },
    outdir: directory,
    entryNames: '[name]-[hash]',
    chunkNames: 'chunks/[name]-[hash]',
    assetNames: 'assets/[name]-[hash]',
    bundle: true,
    plugins: [routeStyles],
    publicPath: '/ui',
    charset: 'utf8',
    jsx: 'automatic',
    splitting: true,
    metafile: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    minify: true,
    legalComments: 'eof',
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' },
    logLevel: 'info',
  });
  const generated = file => relative(directory, resolve(root, file)).split('\\').join('/');
  const outputs = Object.entries(result.metafile.outputs);
  const main = outputs.find(([, info]) => info.entryPoint === 'web/app.jsx');
  const theme = outputs.find(([, info]) => info.entryPoint === 'web/style.css');
  if (!main || !theme) throw new Error('The web application and theme entries must be built');
  const css = [generated(theme[0])];
  if (main[1].cssBundle) css.push(generated(main[1].cssBundle));
  const paths = outputs.map(([file]) => generated(file)).sort();
  const assets = paths.map(path => {
    const file = resolve(directory, path);
    const bytes = readFileSync(file);
    const asset = { path, sha256: createHash('sha256').update(bytes).digest('hex') };
    if (/\.(js|css|ttf)$/.test(path)) {
      writeFileSync(file + '.br', brotliCompressSync(bytes));
      writeFileSync(file + '.gz', gzipSync(bytes, { level: 9 }));
      asset.encodings = ['br', 'gzip'];
    }
    return asset;
  });
  const manifest = { schema: 2, staticStyles: true, entry: { js: generated(main[0]), css }, assets };
  writeFileSync(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

const staging = mkdtempSync(resolve(root, '.web-build-'));
const candidate = resolve(staging, 'generated');
const previous = resolve(staging, 'previous');
try {
  await buildBundle(candidate);
  if (existsSync(output)) renameSync(output, previous);
  try {
    renameSync(candidate, output);
  } catch (error) {
    if (existsSync(previous) && !existsSync(output)) renameSync(previous, output);
    throw error;
  }
} finally {
  // Keep a recoverable copy if the filesystem also rejected restoring the old bundle.
  if (!existsSync(previous) || existsSync(output)) rmSync(staging, { recursive: true, force: true });
}
