import { argon2, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { closeSync, lstatSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { cardShareStore } from './card-share-store.mjs';

const derive = promisify(argon2);
const rateWindow = 5 * 60_000;
const sessionLifetime = 24 * 60 * 60_000;
const passwordConcurrency = 2;
const databaseIdentifier = 0x43445031;
const hashParameters = Object.freeze({
  memory: 19_456, passes: 2, parallelism: 1, tagLength: 32,
});
const hashKind = 'argon2id-v1';
const checksum = value => createHash('sha256').update(value).digest('hex');
const id = () => randomBytes(32).toString('base64url');

function fail(code, message, data = {}) {
  throw Object.assign(new Error(message), { code, ...data });
}

function tokenDigest(token) {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) ? checksum(token) : null;
}

function passwordHash(password, salt) {
  return derive('argon2id', { ...hashParameters, message: Buffer.from(password), nonce: salt });
}

function validatePassword(password) {
  if (typeof password !== 'string' || Buffer.byteLength(password) > 256 || [...password].length < 15) {
    fail('invalid_password', '密码至少需要 15 个字符，且 UTF-8 长度不能超过 256 字节。');
  }
}

function provisioningName(username) {
  const value = typeof username === 'string' ? username.trim() : '';
  if (!value || Buffer.byteLength(value) > 120 || /[\p{Cc}\p{Cf}]/u.test(value)) {
    fail('invalid_username', '请输入有效的用户名，UTF-8 长度不能超过 120 字节。');
  }
  return value;
}

function requirePrivateFile(path) {
  const file = lstatSync(path, { throwIfNoEntry: false });
  if (!file?.isFile() || (file.mode & 0o077)) {
    fail('auth_file_permissions', '认证文件缺失或权限过宽。请检查文件及其权限（0600）。');
  }
}

function transaction(database, action) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK');
    throw error;
  }
}

function prepareDatabase(path, initialize, readOnly = false) {
  if (initialize) {
    try {
      closeSync(openSync(path, 'wx', 0o600));
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  requirePrivateFile(path);
  const database = new DatabaseSync(path, { timeout: 3_000, readOnly });
  try {
    if (initialize) transaction(database, () => {
      const { application_id: identifier } = database.prepare('PRAGMA application_id').get();
      if (identifier !== 0 || database.prepare('SELECT 1 FROM sqlite_schema LIMIT 1').get()) return;
      database.exec(`
        PRAGMA application_id = ${databaseIdentifier};
        PRAGMA user_version = 1;
        CREATE TABLE owner (
          account INTEGER PRIMARY KEY CHECK (account = 1),
          username TEXT NOT NULL,
          password_kind TEXT NOT NULL,
          salt BLOB NOT NULL,
          password_hash BLOB NOT NULL,
          version INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE sessions (
          digest TEXT PRIMARY KEY,
          public_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE rate_limits (
          scope TEXT PRIMARY KEY,
          attempts INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        ) STRICT;
      `);
    });
    if (database.prepare('PRAGMA application_id').get().application_id !== databaseIdentifier ||
        database.prepare('PRAGMA user_version').get().user_version !== 1) {
      fail('auth_schema_invalid', '无法识别认证数据库格式。');
    }
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

function readOwner(database) {
  const row = database.prepare('SELECT * FROM owner WHERE account=1').get();
  if (!row) fail('owner_missing', '请先配置站主账户。');
  if (row.password_kind !== hashKind || row.salt.length !== 16 || row.password_hash.length !== 32) {
    fail('auth_hash_invalid', '站主密码哈希格式无效。');
  }
  return row;
}

function revokeAll(database) {
  database.exec('DELETE FROM sessions; DELETE FROM rate_limits;');
}

// Offline handoff and its read-only verifier must recognize the same provisioned
// database as the service, without initializing an empty or foreign database.
export function openProvisionedAuthDatabase(path, {readOnly = false} = {}) {
  const database = prepareDatabase(path, false, readOnly);
  try {
    readOwner(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export async function initializeAuthStore({ databasePath }, { username, password }) {
  username = provisioningName(username);
  validatePassword(password);
  const salt = randomBytes(16);
  const hash = await passwordHash(password, salt);
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const database = prepareDatabase(databasePath, true);
  try {
    transaction(database, () => {
      if (database.prepare('SELECT 1 FROM owner').get()) fail('owner_exists', '站主账户已配置。');
      database.prepare(`INSERT INTO owner (account, username, password_kind, salt, password_hash, version)
        VALUES (1, ?, ?, ?, ?, 1)`).run(username, hashKind, salt, hash);
    });
  } finally {
    database.close();
  }
}

export function openAuthStore({ databasePath, now = Date.now }) {
  const database = prepareDatabase(databasePath, false);
  let shares, currentSession;
  try {
    shares = cardShareStore(database);
    currentSession = database.prepare(`SELECT public_id AS publicId, expires_at AS expiresAt
      FROM sessions JOIN owner ON owner.version=sessions.version AND owner.account=1
      WHERE digest=? AND expires_at > ?`);
  } catch (error) { database.close(); throw error; }
  let passwordChecks = 0;

  function reserveAttempt(source) {
    const time = now();
    const subject = checksum(String(source ?? 'unknown').slice(0, 128));
    transaction(database, () => {
      database.prepare('DELETE FROM rate_limits WHERE expires_at <= ?').run(time);
      const lookup = database.prepare('SELECT attempts, expires_at FROM rate_limits WHERE scope=?');
      const record = database.prepare(`INSERT INTO rate_limits VALUES (?, 1, ?)
        ON CONFLICT(scope) DO UPDATE SET attempts=attempts+1`);
      for (const [scope, maximum] of [[subject, 8], ['owner', 32]]) {
        const row = lookup.get(scope);
        if (row && row.attempts >= maximum) {
          fail('rate_limited', '尝试次数过多，请稍后再试。', { retryAfter: Math.ceil((row.expires_at - time) / 1000) });
        }
        record.run(scope, time + rateWindow);
      }
    });
  }

  function session(token) {
    const digest = tokenDigest(token);
    if (!digest) return null;
    return currentSession.get(digest, now()) ?? null;
  }

  async function verifyPassword(password, source, verifyOwner) {
    if (passwordChecks >= passwordConcurrency) fail('rate_limited', '尝试次数过多，请稍后再试。', { retryAfter: 1 });
    reserveAttempt(source);
    const owner = readOwner(database);
    if (typeof password !== 'string' || Buffer.byteLength(password) > 256) fail('invalid_credentials', '用户名或密码不正确。');
    passwordChecks += 1;
    let matches;
    try {
      matches = timingSafeEqual(await passwordHash(password, owner.salt), owner.password_hash);
    } finally {
      passwordChecks -= 1;
    }
    if (!matches || !verifyOwner(owner)) fail('invalid_credentials', '用户名或密码不正确。');
    return owner.version;
  }

  return {
    shares,
    assertReady() {
      readOwner(database);
      database.prepare('SELECT digest, public_id, version, expires_at FROM sessions LIMIT 1').get();
      database.prepare('SELECT scope, attempts, expires_at FROM rate_limits LIMIT 1').get();
    },

    async login({ username, password, target = '/cards', source }) {
      const version = await verifyPassword(password, source, owner => typeof username === 'string' && owner.username === username.trim());
      return transaction(database, () => {
        if (readOwner(database).version !== version) fail('invalid_credentials', '用户名或密码不正确。');
        const time = now();
        const token = id();
        const publicId = id();
        const expiresAt = time + sessionLifetime;
        database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(time);
        database.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(checksum(token), publicId, version, expiresAt);
        return { token, publicId, expiresAt, target };
      });
    },

    session,

    async verifySessionPassword({ token, publicId, password, source }) {
      if (!publicId || session(token)?.publicId !== publicId) fail('unauthorized', '请重新登录后继续。');
      const version = await verifyPassword(password, source, () => true);
      const current = session(token);
      if (readOwner(database).version !== version || current?.publicId !== publicId)
        fail('unauthorized', '请重新登录后继续。');
      return current;
    },

    logout(token) {
      const digest = tokenDigest(token);
      if (digest) database.prepare('DELETE FROM sessions WHERE digest=?').run(digest);
    },

    async resetPassword(password) {
      const owner = readOwner(database);
      validatePassword(password);
      const salt = randomBytes(16);
      const hash = await passwordHash(password, salt);
      transaction(database, () => {
        const { changes } = database.prepare(`UPDATE owner SET password_kind=?, salt=?, password_hash=?, version=version+1
          WHERE account=1 AND version=?`).run(hashKind, salt, hash, owner.version);
        if (!changes) fail('owner_changed', '站主配置已改变，请重新执行命令。');
        revokeAll(database);
      });
    },

    revokeAll() {
      transaction(database, () => {
        readOwner(database);
        database.prepare('UPDATE owner SET version=version+1 WHERE account=1').run();
        revokeAll(database);
      });
    },

    close: () => database.close(),
  };
}

export function openServiceAuth(auth) {
  if(auth.mode==='local')return;
  const store=openAuthStore(auth);
  try{store.assertReady();return store;}
  catch(error){store.close();throw error;}
}
