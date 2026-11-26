import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';

test('UI publication fingerprints dependencies, preserves the CSS order and keeps a working build on failure', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cd-build-web-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, 'web'));
  copyFileSync(new URL('../../scripts/build-web.mjs', import.meta.url), join(dir, 'scripts/build-web.mjs'));
  symlinkSync(new URL('../../node_modules', import.meta.url), join(dir, 'node_modules'), 'dir');
  const source = (path, text) => writeFileSync(join(dir, 'web', path), text);
  const asset = path => readFileSync(join(dir, 'web/generated', path));
  const build = () => execFileSync(process.execPath, ['scripts/build-web.mjs'], { cwd: dir, stdio: 'pipe' });
  const inspect = () => {
    const manifest = JSON.parse(asset('manifest.json'));
    assert.equal(manifest.schema, 2);
    const paths = new Set(manifest.assets.map(({ path }) => path));
    for (const path of [manifest.entry.js, ...manifest.entry.css]) assert.ok(paths.has(path), path);
    for (const { path, sha256, encodings } of manifest.assets) {
      const bytes = asset(path);
      assert.match(path, /-[A-Z2-7]{8}\.(js|css)$/);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), sha256);
      assert.deepEqual(encodings, ['br', 'gzip']);
      assert.deepEqual(brotliDecompressSync(asset(path + '.br')), bytes);
      assert.deepEqual(gunzipSync(asset(path + '.gz')), bytes);
    }
    return manifest;
  };
  source('app.jsx', 'import "./page.css"; globalThis.openView = () => import("./view.js");');
  source('style.css', 'body { color: navy }');
  source('page.css', 'body { color: tomato }');
  source('view.js', 'export { default as stylesheet } from "./view.css?route"; export default 1');
  source('view.css', '@import "./reader-type.css";');
  source('reader-type.css', '.reader { color: purple; }');
  build();
  const initial = inspect();
  const other = mkdtempSync(join(tmpdir(), 'cd-build-other-root-'));
  t.after(() => rmSync(other, {recursive:true,force:true}));
  cpSync(join(dir,'web'),join(other,'web'),{recursive:true,filter: path=>path!==join(dir,'web','generated')});
  cpSync(join(dir,'scripts'),join(other,'scripts'),{recursive:true});
  symlinkSync(new URL('../../node_modules', import.meta.url),join(other,'node_modules'),'dir');
  execFileSync(process.execPath,['scripts/build-web.mjs'],{cwd:other,stdio:'pipe'});
  assert.deepEqual(JSON.parse(readFileSync(join(other,'web/generated/manifest.json'),'utf8')),initial,
    'route CSS virtual module names must be independent of the checkout path');

  assert.equal(initial.entry.css.length, 2);
  assert.match(asset(initial.entry.css[0]).toString(), /navy/);
  assert.match(asset(initial.entry.css[1]).toString(), /tomato/);
  const chunk = initial.assets.find(({ path }) => path.startsWith('chunks/'));
  assert.ok(asset(initial.entry.js).includes(chunk.path));
  const lazyCSS = initial.assets.find(({ path }) => path.startsWith('assets/view-')).path;
  assert.match(asset(lazyCSS).toString(), /purple/);
  assert.ok(asset(chunk.path).includes('/ui/' + lazyCSS));
  assert.ok(initial.entry.css.every(path => !asset(path).includes('purple')));
  build();
  assert.deepEqual(inspect(), initial);

  source('reader-type.css', '.reader { color: green; }');
  source('style.css', 'body { color: red }');
  build();
  const updated = inspect();
  assert.notEqual(updated.entry.js, initial.entry.js);
  assert.notEqual(updated.entry.css[0], initial.entry.css[0]);
  assert.equal(updated.entry.css[1], initial.entry.css[1]);
  assert.ok(!updated.assets.some(({ path }) => path === chunk.path));
  assert.ok(!updated.assets.some(({ path }) => path === lazyCSS));

  source('app.jsx', 'import "./missing.js";');
  assert.throws(build, /missing\.js/);
  assert.deepEqual(inspect(), updated);
});
