import { build } from 'esbuild';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'web/generated');
// The table's scrollbar measurement and the modal's scroll lock call rc-util
// directly, outside ConfigProvider. Reuse the page nonce for those style nodes.
const rcStyleNonce = {
  name: 'rc-style-nonce',
  setup(build) {
    build.onLoad({ filter: /@rc-component[\\/]util[\\/]es[\\/]Dom[\\/]dynamicCSS\.js$/ }, ({ path }) => {
      const source = readFileSync(path, 'utf8');
      const original = '  if (csp?.nonce) {\n    styleNode.nonce = csp?.nonce;\n  }';
      if (!source.includes(original)) throw new Error('Review the rc-util CSP adapter after upgrading the dependency');
      const replacement = `  const nonce = csp?.nonce ?? document.querySelector('meta[name="style-nonce"]')?.content;
  if (nonce) styleNode.nonce = nonce;`;
      return { contents: source.replace(original, replacement), loader: 'js' };
    });
  },
};

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['web/style.css'],
  outfile: resolve(output, 'theme.css'),
  bundle: true,
  minify: true,
});
const result = await build({
  absWorkingDir: root,
  entryPoints: ['web/app.jsx'],
  outdir: output,
  entryNames: '[name]',
  chunkNames: 'chunks/[name]-[hash]',
  assetNames: 'assets/[name]-[hash]',
  bundle: true,
  jsx: 'automatic',
  plugins: [rcStyleNonce],
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
const generated = (file) => relative(output, resolve(root, file)).split('\\').join('/');
const outputs = Object.entries(result.metafile.outputs);
const main = outputs.find(([, info]) => info.entryPoint === 'web/app.jsx');
const editor = outputs.find(([, info]) => info.entryPoint === 'web/editor.jsx');
if (!main || !editor) throw new Error('Application and lazy editor must both be built');
const paths = ['theme.css', ...outputs.map(([file]) => generated(file))].sort();
const manifest = {
  schema: 1,
  entry: { js: generated(main[0]), css: ['theme.css', ...(main[1].cssBundle ? [generated(main[1].cssBundle)] : [])] },
  lazyEditor: generated(editor[0]),
  assets: paths.map((path) => ({ path, sha256: createHash('sha256').update(readFileSync(resolve(output, path))).digest('hex') })),
};
writeFileSync(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
