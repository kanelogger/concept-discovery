import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { brotliCompressSync, brotliDecompressSync, gzipSync, gunzipSync } from 'node:zlib';
import { createApp } from '../../server/app.mjs';

const js = 'app-ABCDEFG2.js';
const css = 'theme-ABCDEFG3.css';
const body = 'export const current = true;\n'.repeat(50);
const immutable = 'public, max-age=31536000, immutable';

function release(t, schema, entry, source) {
  const root = mkdtempSync(join(tmpdir(), 'cd-program-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const assets = Object.entries(source).map(([path, content]) => {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    const sha256 = createHash('sha256').update(content).digest('hex');
    if (schema === 1) return { path, sha256 };
    writeFileSync(target + '.br', brotliCompressSync(content));
    writeFileSync(target + '.gz', gzipSync(content));
    return { path, sha256, encodings: ['br', 'gzip'] };
  });
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({schema, entry, assets}));
  return root;
}

async function serve(t, options) {
  const app = createApp({publicUrl:'https://127.0.0.1',authMode:'required',agentToken:'synthetic',api:{},authStore:{},...options});
  await new Promise((resolve, reject) => app.once('error',reject).listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => app.close(resolve)));
  return (path, headers = {}) => new Promise((resolve, reject) => {
    const req = request({host:'127.0.0.1',port:app.address().port,path,headers}, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.once('error', reject);
      res.once('end', () => resolve({status:res.statusCode, headers:res.headers, bytes:Buffer.concat(chunks)}));
    });
    req.once('error', reject).end();
  });
}

test('UI entries and compressed bytes follow the loaded manifest, client weights and cache boundary', async t => {
  const override = 'override-ABCDEFG4.css';
  const root = release(t, 2, {js, css:[css, override]}, {[js]:body,[css]:'body {}',[override]:'main {}','stable.css':'p {}'});
  let ready = true;
  const get = await serve(t, {uiAssetRoot:root,requireLifecycleReadiness:true,lifecycle:{ready:()=>({ready})}});
  writeFileSync(join(root, 'manifest.json'), '{}');
  const page = await get('/login');
  assert.equal(page.status, 200);
  assert.equal(page.headers['cache-control'], 'no-store');
  const entryTags = Array.from(page.bytes.toString().matchAll(/(?:src|href)="\/ui\/([^"]+)"/g), match => match[1]);
  assert.deepEqual(entryTags, [css, override, js]);
  const absolute = 'https://127.0.0.1/ui/' + js;
  const viaProxy = await get(absolute + '?release=1', {'Accept-Encoding':'br'});
  assert.equal(viaProxy.status, 200);
  assert.equal(viaProxy.headers['cache-control'], immutable);
  assert.equal(brotliDecompressSync(viaProxy.bytes).toString(), body);
  assert.equal((await get('/ui/manifest.json')).headers['cache-control'], 'no-store');
  assert.equal(JSON.parse((await get('/ui/manifest.json')).bytes).entry.js, js);
  for (const [accept, expected] of [
    ['gzip, br','br'], ['BR;Q=0, GZIP','gzip'], ['gzip;q=0.8, br;q=0.3','gzip'],
    ['*;q=0.6, br;q=0','gzip'], ['br;q=0.2','br'], ['gzip;q=0.1, identity;q=0.8','identity'],
    ['*;q=0, identity;q=0.1','identity'], ['gzip;q=0, br;q=0','identity'], ['', 'identity'], [undefined,'identity'],
    ['br;q=0,gzip;q=0,identity;q=0',null], ['*;q=0',null], ['zstd, identity;q=0',null],
  ]) {
    const res = await get('/ui/' + js, accept === undefined ? {} : {'Accept-Encoding': accept});
    assert.deepEqual(new Set(res.headers.vary.toLowerCase().split(/,\s*/)), new Set(['accept-encoding','origin','sec-fetch-dest','sec-fetch-mode','sec-fetch-site']));
    if (!expected) {
      assert.equal(res.status, 406, accept);
      assert.equal(res.headers['cache-control'], 'no-store');
      assert.equal(res.bytes.length, 0);
      continue;
    }
    assert.equal(res.status, 200, accept);
    assert.equal(res.headers['cache-control'], immutable);
    assert.equal(res.headers['content-type'], 'text/javascript; charset=utf-8');
    assert.equal(Number(res.headers['content-length']), res.bytes.length);
    assert.equal(res.headers['content-encoding'], expected === 'identity' ? undefined : expected);
    const decoded = expected === 'br' ? brotliDecompressSync(res.bytes) : expected === 'gzip' ? gunzipSync(res.bytes) : res.bytes;
    assert.equal(decoded.toString(), body);
  }
  assert.equal((await get('/ui/' + css)).headers['cache-control'], immutable);
  assert.equal((await get('/ui/stable.css')).headers['cache-control'], 'no-store');
  for (const path of ['/ui/source.js','/ui/../ui/' + js,'/ui/chunks/%2e%2e/' + js,'/ui/' + js + '.br','/ui/unlisted-ABCDEFG2.js',
    'https://127.0.0.1/ui/chunks/../' + js, 'https://127.0.0.1/ui/%2e%2e/api/status', 'https://other.invalid/ui/' + js]) {
    const res = await get(path);
    assert.equal(res.status, 404, path);
    assert.equal(res.headers['cache-control'], 'no-store');
  }
  for (const headers of [{host:'invalid.test'},{'sec-fetch-site':'cross-site'},{origin:'https://invalid.test'}]) {
    for (const target of ['/ui/' + js, absolute]) {
      const res = await get(target, headers);
      assert.equal(res.status, 403);
      assert.equal(res.headers['cache-control'], 'no-store');
    }
  }
  for (const [path,status] of [['/cards',401],['/assets/' + js,401],['/api/session',401],['/api/status',200],['/share',200],['/share-cover.png',200]]) {
    const res = await get(path);
    assert.equal(res.status, status, path);
    assert.equal(res.headers['cache-control'], 'no-store', path);
  }
  ready = false;
  const blocked = await get('/ui/' + js);
  assert.equal(blocked.status, 503);
  assert.equal(blocked.headers['cache-control'], 'no-store');
});

test('old tabs load listed schema 1 chunks; current names win and broken optional encodings fall back', async t => {
  const oldChunk = 'chunks/reader-ABCDEFG5.js';
  const previousRoot = release(t, 1, {js:'app.js',css:['theme.css']}, {
    'app.js':'old entry','theme.css':'old style',[oldChunk]:'old lazy module','common.js':'old version',
  });
  writeFileSync(join(previousRoot, 'unknown.js'), 'unpublished');
  const root = release(t, 2, {js,css:[]}, {[js]:body,'common.js':'current version'});
  rmSync(join(root, js + '.br'));
  symlinkSync(join(previousRoot, 'unknown.js'), join(root, js + '.br'));
  writeFileSync(join(root, js + '.gz'), gzipSync('wrong release'));
  const get = await serve(t, {uiAssetRoot:root,previousUIAssetRoot:previousRoot});
  const res = await get('/ui/' + oldChunk, {'Accept-Encoding':'br'});
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.bytes.toString(), 'old lazy module');
  assert.equal((await get('/ui/common.js')).bytes.toString(), 'current version');
  assert.equal((await get('/ui/unknown.js')).status, 404);
  assert.equal(JSON.parse((await get('/ui/manifest.json')).bytes).schema, 2);
  assert.equal((await get('/ui/' + js, {'Accept-Encoding':'br, gzip'})).bytes.toString(), body);
  assert.equal((await get('/ui/' + js, {'Accept-Encoding':'br, gzip, identity;q=0'})).status, 406);
  const legacy = await serve(t, {uiAssetRoot:previousRoot,authMode:'local',publicUrl:'http://127.0.0.1'});
  const page = await legacy('/cards');
  assert.match(page.bytes.toString(), /href="\/ui\/theme.css"/);
  assert.match(page.bytes.toString(), /src="\/ui\/app.js"/);
  const oldNonce = /name="style-nonce" content="([^"]+)"/.exec(page.bytes.toString())[1];
  assert.ok(page.headers['content-security-policy'].includes("'nonce-" + oldNonce + "'"));
  const oldEntry = await legacy('/ui/app.js');
  assert.equal(oldEntry.headers['cache-control'], 'no-store');
  assert.match(oldEntry.headers.vary, /Authorization/);
  assert.equal((await legacy('/ui/app.js', {authorization:'Bearer expired'})).status, 401);
});

test('a previous release serves the stylesheet referenced by its lazy route', async t => {
  const readerCSS = 'assets/card-reader-ABCDEFG5.css';
  const oldStyle = '.reader{color:purple}';
  const previous = release(t, 2, {js,css:[]}, {[js]:body,[readerCSS]:oldStyle});
  const current = release(t, 2, {js,css:[]}, {[js]:body});
  const get = await serve(t, {uiAssetRoot:current,previousUIAssetRoot:previous});
  const response = await get('/ui/' + readerCSS, {'Accept-Encoding':'br'});
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'text/css; charset=utf-8');
  assert.equal(response.headers['cache-control'], immutable);
  assert.equal(brotliDecompressSync(response.bytes).toString(), oldStyle);
  assert.ok(!(await get('/login')).bytes.includes(readerCSS));
});
