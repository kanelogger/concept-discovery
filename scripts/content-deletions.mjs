#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { closeSync, lstatSync, openSync, readFileSync, realpathSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { hash } from '../lib/read-contract.mjs';
import { openContentReader } from '../server/content-reader.mjs';

const publicId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const digest = /^[0-9a-f]{64}$/;

function requireState(condition, message) {
  if (!condition) throw new Error(message);
}

function privatePath(path) {
  const parent = dirname(path);
  requireState(realpathSync(parent) === parent && lstatSync(parent).isDirectory() &&
    (lstatSync(parent).mode & 0o077) === 0, '删除记录须存放在独立的站主私有目录中');
}

function privateDatabase(path) {
  privatePath(path);
  const file = lstatSync(path);
  requireState(file.isFile() && file.nlink === 1 && (file.mode & 0o077) === 0, '删除记录必须是私有普通文件');
  for (const suffix of ['-journal', '-wal', '-shm']) {
    const sidecar = lstatSync(path + suffix, {throwIfNoEntry:false});
    requireState(!sidecar || (sidecar.isFile() && sidecar.nlink === 1 && (sidecar.mode & 0o077) === 0),
      '删除记录的 SQLite 运行文件必须是私有普通文件');
  }
}

function initialize(file, libraryId, seedPath, seedSha256) {
  privatePath(file);
  requireState(digest.test(seedSha256), '需要独立核实的导入清单摘要');
  requireState(lstatSync(seedPath).isFile(), '导入清单须为普通文件');
  const bytes = readFileSync(seedPath);
  requireState(hash(bytes) === seedSha256, '导入清单摘要不符');
  const seed = JSON.parse(bytes);
  const ids = seed.deletedIds;
  requireState(seed.version === 1 && seed.libraryId === libraryId &&
    Array.isArray(ids) && ids.every(id => typeof id === 'string' && publicId.test(id)) && new Set(ids).size === ids.length,
  '导入清单的库身份或删除 ID 无效');
  closeSync(openSync(file, 'wx', 0o600));
  let db;
  try {
    db = new DatabaseSync(file);
    db.exec(`
      PRAGMA synchronous=FULL;
      BEGIN IMMEDIATE;
      CREATE TABLE registry (singleton INTEGER PRIMARY KEY CHECK (singleton=1), library TEXT NOT NULL,
        seed_sha256 TEXT NOT NULL) STRICT;
      CREATE TABLE decisions (card_id TEXT PRIMARY KEY, decided_at TEXT NOT NULL,
        manifest_sha256 TEXT) STRICT;
    `);
    db.prepare('INSERT INTO registry VALUES (1, ?, ?)').run(libraryId, seedSha256);
    const insert = db.prepare('INSERT INTO decisions VALUES (?, ?, NULL)');
    const now = new Date().toISOString();
    for (const id of ids) insert.run(id, now);
    db.exec('COMMIT');
  } catch (error) {
    db?.close();
    unlinkSync(file);
    throw error;
  }
  db.close();
}

function verifiedTargets(directory, libraryId, sha256, ids) {
  requireState(digest.test(sha256), '需要已独立核准的内容包摘要');
  const reader = openContentReader({directory, libraryId, origin:'https://local.invalid', manifestSha256:sha256});
  try {
    const {publicRefs, reservedMainIds} = reader.inventory();
    const visible = new Set(publicRefs);
    const reserved = new Set(reservedMainIds);
    requireState(ids.every(id => reserved.has(id) && !visible.has(id)), '目标必须是当前内容包中已保留且不可读取的主卡 ID');
  } finally {
    reader.close();
  }
}

function currentIds(db) {
  return db.prepare('SELECT card_id FROM decisions ORDER BY card_id').all().map(row => row.card_id);
}

function exportBytes(libraryId, deletedIds) {
  return JSON.stringify({version:1, libraryId, deletedIds}) + '\n';
}

export function contentDeletionsCommand(argv) {
  const {positionals, values} = parseArgs({args:argv, allowPositionals:true, options:{
    help:{type:'boolean'}, database:{type:'string'}, 'library-id':{type:'string'}, seed:{type:'string'},
    'seed-sha256':{type:'string'}, release:{type:'string'}, 'manifest-sha256':{type:'string'},
    'current-sha256':{type:'string'},
  }});
  const usage = `content:deletions <init|plan|add|export> --database PATH --library-id ID
  init: --seed 已核准的删除清单 --seed-sha256 SHA256
  plan/add: --current-sha256 SHA256 --release 核准的发布目录 --manifest-sha256 SHA256 主卡ID [主卡ID ...]
  export: --current-sha256 SHA256 输出供发布和恢复使用的累计 deletions.json`;
  if (values.help) return usage;
  const [action, ...ids] = positionals;
  const libraryId = values['library-id'];
  requireState(['init','plan','add','export'].includes(action) && values.database && libraryId?.trim(), usage);
  const file = resolve(values.database);
  if (action === 'init') {
    requireState(!ids.length && values.seed && values['seed-sha256'] &&
      !values.release && !values['manifest-sha256'] && !values['current-sha256'], usage);
    initialize(file, libraryId, resolve(values.seed), values['seed-sha256']);
  } else {
    requireState(!values.seed && !values['seed-sha256'] && digest.test(values['current-sha256']), usage);
  }
  const changes = ['plan','add'].includes(action);
  if (changes) {
    requireState(ids.length && ids.every(id => publicId.test(id)) && new Set(ids).size === ids.length &&
      values.release && values['manifest-sha256'], usage);
  } else {
    requireState(!ids.length && !values.release && !values['manifest-sha256'], usage);
  }
  privateDatabase(file);
  const db = new DatabaseSync(file, {readOnly:action !== 'add', timeout:5000});
  try {
    requireState(db.prepare('SELECT library FROM registry WHERE singleton=1').get()?.library === libraryId,
      '删除记录不属于这座知识库');
    const sha256 = values['manifest-sha256'];
    if (changes) verifiedTargets(resolve(values.release), libraryId, sha256, ids);
    if (action === 'add') db.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE');
    const deletedIds = currentIds(db);
    const bytes = exportBytes(libraryId, deletedIds);
    requireState(action === 'init' || hash(bytes) === values['current-sha256'], '累计删除清单与独立保管的当前摘要不符');
    if (action === 'plan') return exportBytes(libraryId, [...new Set([...deletedIds, ...ids])].sort());
    if (action === 'add') {
      const insert = db.prepare('INSERT INTO decisions VALUES (?, ?, ?) ON CONFLICT(card_id) DO NOTHING');
      const now = new Date().toISOString();
      for (const id of ids) insert.run(id, now, sha256);
      const next = exportBytes(libraryId, currentIds(db));
      db.exec('COMMIT');
      return next;
    }
    return bytes;
  } finally {
    db.close();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { process.stdout.write(contentDeletionsCommand(process.argv.slice(2)) + (process.argv.includes('--help') ? '\n' : '')); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
