import { createHash, randomUUID } from 'node:crypto';
import { closeSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, sep } from 'node:path';
import { openProvisionedAuthDatabase } from '../server/auth-store.mjs';
import { cardShareStore } from '../server/card-share-store.mjs';
import { openContentReader } from '../server/content-reader.mjs';
import { readClosedContentApproval } from './content-approval.mjs';

const digest = /^[0-9a-f]{64}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function requireState(value, message) {
  if (!value) throw new Error(message);
}

function contains(directory, path) {
  const tail = relative(directory,path);
  return !isAbsolute(tail) && tail !== '..' && !tail.startsWith('..'+sep);
}

function privateFile(path) {
  const stat = lstatSync(path);
  requireState(stat.isFile() && stat.nlink === 1 && !(stat.mode & 0o077), '认证库必须是独立的私有普通文件');
  for (const suffix of ['-journal', '-wal', '-shm']) {
    const sidecar = lstatSync(path + suffix, {throwIfNoEntry:false});
    requireState(!sidecar || (sidecar.isFile() && sidecar.nlink === 1 && !(sidecar.mode & 0o077)),
      '认证库的 SQLite 运行文件必须是独立私有文件');
  }
  return stat;
}

function fileSha256(path) {
  const fd = openSync(path, 'r');
  try {
    const hash = createHash('sha256'), buffer = Buffer.alloc(64 * 1024);
    let bytes;
    while ((bytes = readSync(fd,buffer)) > 0) hash.update(buffer.subarray(0,bytes));
    return hash.digest('hex');
  } finally {
    closeSync(fd);
  }
}

function transaction(db, action) {
  db.exec('BEGIN EXCLUSIVE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

function hasTable(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name));
}

function binding(db) {
  return db.prepare('SELECT * FROM content_auth_binding WHERE singleton=1').get();
}

function identity(row, libraryId) {
  requireState(row?.library_id === libraryId && uuid.test(row.volume_id) && uuid.test(row.generation),
    '认证卷的绑定或库身份不符');
  return {volumeId:row.volume_id, generation:row.generation};
}

function sameVolume(actual, expected) {
  return actual?.volumeId === expected?.volumeId && actual?.generation === expected?.generation;
}

function checkLegacyFences(db, deletedIds) {
  if (hasTable(db,'card_share_pending_deletions')) {
    requireState(!db.prepare('SELECT 1 FROM card_share_pending_deletions LIMIT 1').get(), '认证库仍有待删记录，请先结算');
  }
  if (hasTable(db,'card_share_deletions')) {
    const deleted = new Set(deletedIds);
    requireState(db.prepare('SELECT card_id FROM card_share_deletions').all().every(r => deleted.has(r.card_id)),
      '外部删除记录漏列认证卷中的永久决定');
  }
}

function bind(db, options, approval) {
  const {databasePath,libraryId,sourceSha256,checkpointSha256} = options;
  requireState(approval.authIdentity === null && typeof sourceSha256 === 'string' && digest.test(sourceSha256),
    '首次绑定须关闭入口，并提供已核实来源的独立旧认证库摘要');
  if (hasTable(db,'content_auth_binding')) {
    const row = binding(db);
    requireState(row?.action === 'bind' && row.checkpoint === checkpointSha256 &&
      row.source_sha256 === sourceSha256 && row.ready === 1, '已绑定的认证卷不能重新认领');
    return identity(row,libraryId);
  }
  requireState(!lstatSync(databasePath+'-wal',{throwIfNoEntry:false})?.size &&
    !lstatSync(databasePath+'-journal',{throwIfNoEntry:false})?.size,
    '旧认证库仍有未封存的日志，请先停写并取得一致冷副本');
  requireState(fileSha256(databasePath) === sourceSha256, '旧认证库与站主核实的来源摘要不符');
  const authIdentity = {volumeId:randomUUID(),generation:randomUUID()};
  cardShareStore(db);
  db.exec(`
    CREATE TABLE content_auth_binding (
      singleton INTEGER PRIMARY KEY CHECK (singleton=1), library_id TEXT NOT NULL, volume_id TEXT NOT NULL,
      generation TEXT NOT NULL, source_sha256 TEXT NOT NULL, action TEXT NOT NULL,
      checkpoint TEXT NOT NULL, ready INTEGER NOT NULL CHECK (ready IN (0,1))
    ) STRICT;
    CREATE TABLE content_auth_purges (card_id TEXT PRIMARY KEY) STRICT;
  `);
  db.prepare('INSERT INTO content_auth_binding VALUES (1,?,?,?,?,?,?,1)')
    .run(libraryId,authIdentity.volumeId,authIdentity.generation,sourceSha256,'bind',checkpointSha256);
  return authIdentity;
}

function checkPreviewOwnership(db, deletedIds) {
  // A preview whose old token lost its card link cannot be attributed to a
  // particular purge. Preserve it for owner review or an all-links restore.
  if (deletedIds.length) requireState(!db.prepare(`SELECT 1 FROM card_share_previews p
    WHERE NOT EXISTS (SELECT 1 FROM card_shares s WHERE s.token=p.token) LIMIT 1`).get(),
    '认证库有归属不明的分享封面，不能确认删除范围');
}

function checkPurgeReceipts(db, deletedIds) {
  checkPreviewOwnership(db,deletedIds);
  const receipts = db.prepare(`SELECT p.card_id
    FROM content_auth_purges p JOIN card_share_deletions d USING(card_id)
    LEFT JOIN card_shares s USING(card_id) WHERE s.token IS NULL AND s.content IS NULL`).all();
  const ids = new Set(receipts.map(r=>r.card_id));
  requireState(ids.size === deletedIds.length && deletedIds.every(id=>ids.has(id)),
    '永久删除的认证库物理清理尚未逐条核实');
}

// Keep the read connection open alongside the service. A replacement at the
// configured path must not silently diverge from the service's open auth file.
export function openAuthIdentityVerifier(databasePath, libraryId) {
  const original = privateFile(databasePath);
  const db = openProvisionedAuthDatabase(databasePath,{readOnly:true});
  try {
    // These checks have a fixed set of SQL statements. Reuse the compiled
    // statements, while each .get()/.all() still reads the live auth connection.
    const statements = new Map();
    const queries = {
      prepare(sql) {
        if (!statements.has(sql)) statements.set(sql, db.prepare(sql));
        return statements.get(sql);
      },
    };
    requireState(hasTable(queries,'content_auth_binding'), '认证卷尚未显式绑定');
    const row = binding(queries);
    const observed = identity(row,libraryId);
    requireState(row.ready === 1, '认证卷交接尚未完成');
    function verify(expected, deletedIds) {
      const stat = privateFile(databasePath);
      requireState(original.dev === stat.dev && original.ino === stat.ino, '认证卷文件已更换');
      const current = binding(queries);
      requireState(current?.ready === 1 && sameVolume(identity(current,libraryId),expected), '认证卷或恢复代次不符');
      requireState(Array.isArray(deletedIds), '缺少已核实的永久删除记录');
      checkLegacyFences(queries,deletedIds);
      checkPurgeReceipts(queries,deletedIds);
      return true;
    }
    return {identity:observed, verify, close:()=>db.close()};
  } catch (error) {
    db.close();
    throw error;
  }
}

function verifyDeletionTargets(reader, deletedIds) {
  const inventory = reader.inventory();
  const accessible = new Set(inventory.publicRefs);
  const reserved = new Set(inventory.reservedRefs);
  const main = new Set(inventory.reservedMainIds);
  for (const id of deletedIds) {
    requireState(!accessible.has(id), '永久删除目标仍可在此内容包读取');
    requireState(!reserved.has(id) || main.has(id), '永久删除决定必须指定主卡稳定公开 ID');
  }
}

// Call only with traffic drained and every auth writer stopped. The closed
// control checkpoint is owned outside the auth backup and is never issued here.
export function handoffContentAuth(action, options) {
  const {databasePath,directory,manifestSha256,libraryId,checkpointSha256,offline} = options;
  requireState(['bind','reconcile','restore'].includes(action) && offline === true,
    '请选择交接动作，并确认已关闭入口、排空请求、停止认证写入');
  requireState(typeof manifestSha256 === 'string' && digest.test(manifestSha256), '需要独立核实的内容清单摘要');
  const authRoot = dirname(realpathSync(databasePath)), release = realpathSync(directory), control = realpathSync(options.controlDirectory);
  const roots = [authRoot,release,control];
  requireState(roots.every((path,i)=>roots.every((other,j)=>i===j || !contains(path,other))),
    '认证卷、候选内容和控制记录必须位于三个独立目录');
  const approval = readClosedContentApproval(options);
  const reader = openContentReader({directory,manifestSha256,libraryId,origin:'https://local.invalid'});
  try {
    verifyDeletionTargets(reader,approval.deletedIds);
  } finally {
    reader.close();
  }
  privateFile(databasePath);
  const db = openProvisionedAuthDatabase(databasePath);
  try {
    // Retain the exclusive SQLite lock between the purge, VACUUM and final
    // receipt. A disconnected writer cannot race the generation switch.
    db.exec('PRAGMA locking_mode=EXCLUSIVE; PRAGMA secure_delete=ON');
    const start = transaction(db,()=>{
      readClosedContentApproval(options);
      checkLegacyFences(db,approval.deletedIds);
      if (action === 'bind') return {done:bind(db,options,approval)};
      requireState(hasTable(db,'content_auth_binding'), '冷备或现有认证库必须已绑定，未标记备份须先核实来源');
      const row = binding(db), current = identity(row,libraryId);
      requireState(current.volumeId === approval.authIdentity?.volumeId, '闭门记录与认证卷身份不符');
      const retry = row.action === action && row.checkpoint === checkpointSha256;
      requireState(row.checkpoint !== checkpointSha256 || retry, '此闭门检查点已用于其他交接动作');
      requireState(row.ready === 1 || retry, '已有未完成的认证交接，请续跑原检查点');
      if (retry && row.ready === 1) {
        checkPurgeReceipts(db,approval.deletedIds);
        return {done:current};
      }
      requireState(action === 'restore' || sameVolume(current,approval.authIdentity), '日常清理必须使用当前核准的认证世代');
      if (action === 'reconcile') checkPreviewOwnership(db,approval.deletedIds);
      db.prepare('UPDATE content_auth_binding SET action=?,checkpoint=?,ready=0').run(action,checkpointSha256);
      if (action === 'restore' && !retry) {
        db.exec('UPDATE owner SET version=version+1 WHERE account=1; DELETE FROM sessions; DELETE FROM rate_limits;');
        cardShareStore(db).revokeAll();
        // Includes orphaned previews in exceptionally old restored schemas.
        db.exec('DELETE FROM card_share_previews');
      }
      return {current};
    });
    if (start.done) return start.done;
    const shares = cardShareStore(db);
    for (const id of approval.deletedIds) {
      readClosedContentApproval(options);
      const result = shares.purge(id);
      requireState(result.checkpointed && result.unpublished && shares.purged(id), '删除分享的冻结正文、封面和 WAL 尚未完成');
      db.prepare('INSERT OR IGNORE INTO content_auth_purges VALUES (?)').run(id);
    }
    if (action === 'restore') {
      db.exec('VACUUM');
      requireState(db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get().busy === 0, '冷备恢复的认证库 WAL 尚未清理');
    }
    return transaction(db,()=>{
      readClosedContentApproval(options);
      checkLegacyFences(db,approval.deletedIds);
      checkPurgeReceipts(db,approval.deletedIds);
      const generation = action === 'restore' ? randomUUID() : start.current.generation;
      db.prepare('UPDATE content_auth_binding SET ready=1,generation=? WHERE singleton=1').run(generation);
      return {volumeId:start.current.volumeId,generation};
    });
  } finally {
    db.close();
  }
}
