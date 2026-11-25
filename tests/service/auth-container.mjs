import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request as requestHTTP } from 'node:http';
import { createServer, request } from 'node:https';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { runtime } from './runtime.mjs';

const run = promisify(execFile);
const address = '127.0.0.1';
const fixture = await runtime('auth-container');
const compose = ['compose', '-p', fixture.name, '--env-file', join(fixture.root, 'compose.env'), '-f', 'deploy/compose.yaml'];
const docker = (...args) => run('docker', [...compose, ...args], { timeout: 120_000 });
const certFile = join(fixture.dir, 'auth-test.crt');
const keyFile = join(fixture.dir, 'auth-test.key');
let proxy;
let passed = false;
try {
  const generated = JSON.parse(readFileSync('server/share-materials/catalog.json', 'utf8'))['confirmation-bias'];
  const title = generated.cardTitle;
  const assets = join(fixture.root, 'workspace', 'data', 'assets');
  mkdirSync(assets, { recursive: true });
  writeFileSync(join(assets, 'share-fixture.png'), Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF/0AAAAASUVORK5CYII=', 'base64'));
  const card = await fixture.createDocument({
    title, markdown: '## 我的理解\n\n隔离知识库只有验证后才能读取。\n\n![配图](assets/share-fixture.png)',
  });
  await fixture.kernel('/api/attr/setBlockAttrs', { id: card.id, attrs: { 'custom-cd-legacy-id': generated.id } });
  const supplement = await fixture.createDocument({ title: '独立附读', markdown: '附读正文', parent: card.id });
  // A legacy supplement can lack the explicit article kind but still has a parent.
  await fixture.kernel('/api/attr/setBlockAttrs', { id: supplement.id, attrs: { 'custom-cd-kind': 'concept' } });
  execFileSync('openssl', ['req', '-x509', '-nodes', '-newkey', 'rsa:2048', '-days', '1', '-sha256',
    '-subj', '/CN=isolated-auth', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyFile, '-out', certFile], { stdio: 'ignore' });
  const cert = readFileSync(certFile);
  proxy = createServer({ cert, key: readFileSync(keyFile) }, (req, res) => {
    const upstream = requestHTTP({ host: address, port: fixture.port, path: req.url, method: req.method, headers: req.headers }, response => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  });
  await new Promise((resolve, reject) => {
    proxy.once('error', reject);
    proxy.listen(0, address, resolve);
  });
  const origin = `https://${address}:${proxy.address().port}`;
  const call = (path, { method = 'GET', body, cookie, headers } = {}) => new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(origin + path, { method, ca: cert, headers: {
      ...(method === 'GET' ? {} : { Origin: origin }),
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }),
      ...(cookie ? { Cookie: cookie } : {}), ...headers,
    } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({
        status: response.statusCode, headers: response.headers,
        json: () => JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('isolated HTTPS request timeout')));
    req.end(payload);
  });

  await docker('stop', 'app');
  const serviceFile = join(fixture.root, 'service.json');
  const service = JSON.parse(readFileSync(serviceFile, 'utf8'));
  service.publicUrl = origin;
  service.auth = { mode: 'required', databaseFile: 'auth.sqlite' };
  writeFileSync(serviceFile, JSON.stringify(service, null, 2) + '\n');
  const clientFile = join(fixture.root, 'client.json');
  const client = JSON.parse(readFileSync(clientFile, 'utf8'));
  writeFileSync(clientFile, JSON.stringify({ ...client, url: origin }) + '\n');

  const username = 'synthetic-container-owner';
  const password = 'Long password for a synthetic integration fixture';
  const setup = `import { initializeAuthStore } from './server/auth-store.mjs';
    await initializeAuthStore({ databasePath: '/state/auth.sqlite' },
      { username: ${JSON.stringify(username)}, password: ${JSON.stringify(password)} });
    console.log(process.version);`;
  const setupResult = await docker('run', '--rm', '--no-deps', '-T', 'app', 'node', '--input-type=module', '-e', setup);
  await docker('start', 'app');
  let ready;
  for (let attempt = 0; attempt < 60; attempt++) {
    ready = await call('/api/status').catch(() => null);
    if (ready?.status === 200) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(ready?.status, 200);

  const path = `/cards/${card.id}`;
  assert.equal((await call(path, { headers: { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' } })).status, 302);
  const endpoint = '/api/v1/commands/get-document';
  const body = { id: card.id };
  assert.equal((await call(endpoint, { method: 'POST', body })).status, 401);
  const verified = await call('/api/session/login', { method: 'POST', body: { username, password, target: path } });
  assert.equal(verified.status, 200);
  const cookie = verified.headers['set-cookie'][0].split(';')[0];
  assert.equal(verified.json().data.target, path);
  const ownerCard = (await call(endpoint, { method: 'POST', body, cookie })).json().data;
  assert.equal(ownerCard.title, title);
  assert.equal(ownerCard.shareable, true);
  const ownerSupplement = (await call(endpoint, { method: 'POST', body: { id: supplement.id }, cookie })).json().data;
  assert.equal(ownerSupplement.title, '独立附读');
  assert.equal(ownerSupplement.shareable, undefined);

  const management = '/api/card-shares/' + card.id;
  assert.equal((await call(management, { method: 'PUT' })).status, 401);
  assert.equal((await call('/api/card-shares/' + supplement.id, { method: 'PUT', cookie })).status, 404);
  const created = await call(management, { method: 'PUT', cookie });
  assert.equal(created.status, 200, JSON.stringify(created.json()));
  const shared = new URL(created.json().data.url);
  const token = shared.hash.slice(1);
  assert.equal((await call(shared.pathname, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 200);
  const preview = created.json().data.preview;
  const coverUrl = new URL(preview.image);
  assert.equal((await call(coverUrl.pathname, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).headers['content-type'], 'image/png');
  const openShare = () => call('/api/card-share/read', { method: 'POST', body: { token, previewId: preview.id } });
  const publicCard = await openShare();
  assert.equal(publicCard.status, 200);
  assert.equal(publicCard.json().data.title, title);
  assert.equal(publicCard.json().data.preview.title, generated.title);
  assert.equal(publicCard.json().data.preview.description, generated.description);
  assert.match(publicCard.json().data.html, /隔离知识库只有验证后才能读取/);
  assert.match(publicCard.json().data.html, /src="data:image\/png;base64,/);
  assert.doesNotMatch(publicCard.json().data.html, /附读正文|\bassets\//);
  assert.equal((await call('/assets/share-fixture.png')).status, 401);
  assert.equal((await call(endpoint, { method: 'POST', body: { ...body, token } })).status, 401);
  const revoked = await call(management, { method: 'DELETE', cookie, body: { token } });
  assert.equal(revoked.status, 200, JSON.stringify(revoked.json()));
  assert.equal((await openShare()).status, 404);
  assert.equal((await call(coverUrl.pathname)).status, 404);

  const recreated = await call(management, { method: 'PUT', cookie });
  const restoredToken = new URL(recreated.json().data.url).hash.slice(1);
  await docker('run', '--rm', '--no-deps', '-T', 'app', 'node', 'bin/auth-admin.mjs', 'revoke-shares');
  assert.equal((await call('/api/card-share/read', { method: 'POST', body: { token: restoredToken } })).status, 404);
  assert.equal((await call(new URL(recreated.json().data.url).pathname)).status, 404);
  assert.equal((await call(endpoint, { method: 'POST', body, cookie })).status, 200);

  const cli = run(process.execPath, ['bin/concept-discovery.mjs', 'get-document'], {
    env: { ...process.env, NODE_EXTRA_CA_CERTS: certFile, CONCEPT_DISCOVERY_CONFIG: clientFile }, timeout: 10_000,
  });
  cli.child.stdin.end(JSON.stringify(body));
  assert.equal(JSON.parse((await cli).stdout).data.title, title);

  await docker('run', '--rm', '--no-deps', '-T', 'app', 'node', 'bin/auth-admin.mjs', 'revoke-all');
  assert.equal((await call(endpoint, { method: 'POST', body, cookie })).status, 401);
  fixture.record('required-mode-container', { node: setupResult.stdout.trim(), authenticatedSiyuanRead: true, agentReadWithHTTPS: true, adminRevokedSession: true, anonymousCardShare: true, ownerAndAdminRevokedShare: true });
  passed = true;
  console.log('PASS HTTPS login, real SiYuan, Agent CLI and host session revocation');
} finally {
  if (proxy?.listening) {
    await new Promise(resolve => { proxy.close(resolve); proxy.closeAllConnections(); });
  }
  await fixture.finish(passed);
}
