import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { initializeAuthStore, openAuthStore } from '../../server/auth-store.mjs';

const username = '合成用户';
const password = 'synthetic-password-for-tests';

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'cd-auth-store-'));
  const databasePath = join(root, 'auth.sqlite');
  let time = Date.UTC(2026, 10, 23);
  const config = { databasePath, now: () => time };
  const stores = [];
  t.after(() => {
    for (const store of stores) store.close();
    rmSync(root, { recursive: true, force: true });
  });
  const open = () => {
    const store = openAuthStore(config);
    stores.push(store);
    return store;
  };
  await initializeAuthStore(config, { username, password });
  const store = open();
  const login = ({ target = '/cards', source = 'test-source', ...credentials } = {}) =>
    store.login({ username, password, target, source, ...credentials });
  return { config, login, open, store, advance: milliseconds => { time += milliseconds; } };
}

test('private owner file, duplicate provisioning, session restart, expiry and logout', async t => {
  const { config, login, open, store, advance } = await fixture(t);
  store.assertReady();
  assert.equal(statSync(config.databasePath).mode & 0o777, 0o600);
  await assert.rejects(initializeAuthStore(config, { username, password }), { code: 'owner_exists' });
  const session = await login({ target: '/?id=old' });
  assert.equal(session.target, '/?id=old');
  assert.notEqual(session.token, session.publicId);
  assert.equal(store.session(session.publicId), null);
  assert.equal(session.expiresAt, config.now() + 24 * 60 * 60_000);
  assert.equal(readFileSync(config.databasePath).includes(Buffer.from(password)), false);
  assert.equal(readFileSync(config.databasePath).includes(Buffer.from(session.token)), false);
  const restarted = open();
  assert.deepEqual({ ...restarted.session(session.token) }, { publicId: session.publicId, expiresAt: session.expiresAt });
  advance(24 * 60 * 60_000);
  assert.equal(restarted.session(session.token), null);
  const replacement = await login();
  restarted.logout(replacement.token);
  restarted.logout(replacement.token);
  assert.equal(store.session(replacement.token), null);
});

test('wrong credentials and attempts across processes remain rate limited until the window expires', async t => {
  const { login, open, advance } = await fixture(t);
  await assert.rejects(login({ username: '另一个账户' }), { code: 'invalid_credentials' });
  for (let attempt = 0; attempt < 7; attempt++) {
    await assert.rejects(login({ password: 'incorrect' }), { code: 'invalid_credentials' });
  }
  await assert.rejects(open().login({ username, password, source: 'test-source' }),
    { code: 'rate_limited', retryAfter: 300 });
  advance(300_000);
  assert.ok((await login()).token);
});

test('global quota limits rotating sources and password hashing caps simultaneous checks', async t => {
  const { login } = await fixture(t);
  const active = [login({ source: 'first' }), login({ source: 'second' })];
  await assert.rejects(login({ source: 'third' }), { code: 'rate_limited', retryAfter: 1 });
  await Promise.all(active);
  for (let i = 0; i < 30; i++) {
    await assert.rejects(login({ source: `synthetic-${i}`, password: 'incorrect' }), { code: 'invalid_credentials' });
  }
  await assert.rejects(login({ source: 'new-source' }), { code: 'rate_limited', retryAfter: 300 });
});

test('password reconfirmation stays bound to the session and refuses revocation during the check', async t => {
  const { login, open, store } = await fixture(t);
  const { token, publicId, expiresAt } = await login();
  const request = { token, publicId, password, source:'test-source' };
  for (const invalid of [{...request, token:publicId}, {...request, publicId:token}])
    await assert.rejects(store.verifySessionPassword(invalid), { code:'unauthorized' });
  await assert.rejects(store.verifySessionPassword({...request, password:'incorrect'}), { code:'invalid_credentials' });
  assert.deepEqual({...await store.verifySessionPassword(request)}, { publicId, expiresAt });
  const pending = store.verifySessionPassword(request);
  open().logout(token);
  await assert.rejects(pending, { code:'unauthorized' });
});

test('revocation fences in-flight password checks and password reset revokes established sessions', async t => {
  const { login, open, store } = await fixture(t);
  const original = await login();
  const inFlight = login();
  const otherProcess = open();
  otherProcess.revokeAll();
  await assert.rejects(inFlight, { code: 'invalid_credentials' });
  assert.equal(store.session(original.token), null);
  const replacement = await login();
  const newPassword = 'a different synthetic password';
  await otherProcess.resetPassword(newPassword);
  assert.equal(store.session(replacement.token), null);
  await assert.rejects(login(), { code: 'invalid_credentials' });
  assert.ok((await login({ password: newPassword })).token);
});

test('startup rejects permissive storage and initialization never overwrites an unknown database', async t => {
  const { config } = await fixture(t);
  chmodSync(config.databasePath, 0o644);
  assert.throws(() => openAuthStore(config), { code: 'auth_file_permissions' });
  chmodSync(config.databasePath, 0o600);
  const databasePath = join(config.databasePath, '..', 'unknown.sqlite');
  const unknown = Buffer.from('pre-existing synthetic state');
  writeFileSync(databasePath, unknown, { mode: 0o600 });
  await assert.rejects(initializeAuthStore({ databasePath }, { username, password }));
  assert.deepEqual(readFileSync(databasePath), unknown);
});

test('clearing shares from a restored owner database leaves its old links unusable', async t => {
  const { config, store } = await fixture(t);
  const id = '20261124000000-backup1';
  const token = store.shares.create(id, store.shares.state(id).generation, { title: '备份测试', html: '<p>正文</p>' });
  const saved = join(config.databasePath, '..', 'restored.sqlite');
  copyFileSync(config.databasePath, saved);
  chmodSync(saved, 0o600);
  assert.equal(store.shares.revoke(id, token), true);
  const restored = openAuthStore({ databasePath: saved });
  t.after(() => restored.close());
  assert.equal(restored.shares.cardFor(token), id);
  restored.shares.revokeAll();
  assert.equal(restored.shares.cardFor(token), undefined);
  assert.equal(restored.shares.state(id).token, null);
});
