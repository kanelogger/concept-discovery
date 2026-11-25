import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fail, hash } from '../lib/siyuan.mjs';

const lifetime = 5 * 60_000;
const actions = new Set(['archive', 'restore', 'purge', 'mark-archive', 'compensate', 'resume']);
const databaseActions = new Set(['create','edit','archive','restore','purge','resume','compensate']);
const states = new Set(['queued', 'running', 'needs-review', 'complete', 'cancelled']);

/** Host-private durable tasks. The worker must hold its instance lock while executing a task. */
export function openCardLifecycleTasks(path, { now = Date.now, databaseFirst = false } = {}) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA synchronous = FULL;
    PRAGMA secure_delete = ON;
    CREATE TABLE IF NOT EXISTS lifecycle_previews (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL, plan TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS lifecycle_tasks (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, state TEXT NOT NULL, started INTEGER NOT NULL,
      plan TEXT NOT NULL, progress TEXT NOT NULL
    ) STRICT;`);
  if (databaseFirst) {
    db.exec(`CREATE TABLE IF NOT EXISTS lifecycle_database_purges (
        id TEXT NOT NULL, batchId TEXT NOT NULL, plan TEXT NOT NULL, PRIMARY KEY(id,batchId)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS lifecycle_database_purge_contributions (
        id TEXT NOT NULL, batchId TEXT NOT NULL, evidence TEXT NOT NULL, PRIMARY KEY(id,batchId)
      ) STRICT;`);
    if (!db.prepare('PRAGMA table_info(lifecycle_database_purges)').all().some(column=>column.name==='contributionVersion'))
      db.exec('ALTER TABLE lifecycle_database_purges ADD COLUMN contributionVersion INTEGER NOT NULL DEFAULT 0');
  }
  const preview = db.prepare('SELECT * FROM lifecycle_previews WHERE id = ? AND owner = ?');
  const task = db.prepare('SELECT * FROM lifecycle_tasks WHERE id = ?');
  const removePreview = db.prepare('DELETE FROM lifecycle_previews WHERE id = ?');
  const view = row => {
    const {originalId} = JSON.parse(row.plan);
    return {id:row.id,state:row.state,startedAt:row.started,progress:JSON.parse(row.progress),...(originalId && {originalId})};
  };
  const internal = row => ({ ...view(row), plan:JSON.parse(row.plan) });
  const ownerKey = owner => hash(owner);
  return {
    preview(owner, plan) {
      if (!(databaseFirst ? databaseActions : actions).has(plan?.action) || typeof plan.library !== 'string' || !plan.library)
        fail('invalid_input', '预览必须包含操作和已核实的知识库。');
      const id = randomUUID(), expiresAt = now() + lifetime;
      db.prepare('DELETE FROM lifecycle_previews WHERE expires <= ?').run(now());
      db.prepare('INSERT INTO lifecycle_previews VALUES (?, ?, ?, ?)').run(id, ownerKey(owner), expiresAt, JSON.stringify(plan));
      return { id, expiresAt };
    },
    confirmationPlan(owner,id) {
      const row=preview.get(id,ownerKey(owner));
      return row && row.expires>now() ? JSON.parse(row.plan) : null;
    },
    confirmation(owner, id) {
      const key = ownerKey(owner);
      const existing = task.get(id);
      if (existing?.owner === key) return { task:view(existing) };
      const pending = preview.get(id, key);
      if (!pending || pending.expires <= now()) fail('invalid_preview', '预览已失效，请重新预览。');
      return { action:JSON.parse(pending.plan).action };
    },
    confirm(owner, id) {
      const key = ownerKey(owner);
      db.exec('BEGIN IMMEDIATE');
      try {
        const existing = task.get(id);
        if (existing?.owner === key) {
          db.exec('COMMIT');
          return view(existing);
        }
        const pending = preview.get(id, key);
        if (!pending || pending.expires <= now()) fail('invalid_preview', '预览已失效，请重新预览。');
        db.prepare('INSERT INTO lifecycle_tasks VALUES (?, ?, ?, ?, ?, ?)').run(id, key, 'queued', now(), pending.plan, '{}');
        removePreview.run(id);
        const confirmed = view(task.get(id));
        db.exec('COMMIT');
        return confirmed;
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }
    },
    invalidateRestorePreviews(library,rawId) {
      db.prepare(`DELETE FROM lifecycle_previews WHERE json_extract(plan,'$.action')='restore'
        AND json_extract(plan,'$.library')=? AND json_extract(plan,'$.rawId')=?`).run(library,rawId);
    },
    finishDatabaseWrite(id,progress) {
      const row=task.get(id);
      const plan=row && JSON.parse(row.plan);
      if (!databaseFirst || row?.state!=='running' || !databaseActions.has(plan?.action))
        fail('operation_conflict','数据库操作没有可结算的写入。');
      const {title:_title,markdown:_markdown,...metadata}=plan;
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('UPDATE lifecycle_tasks SET state=?,plan=?,progress=? WHERE id=?')
          .run(plan.action==='purge' ? 'awaiting-export' : 'complete',JSON.stringify(metadata),JSON.stringify(progress),id);
        if (plan.action==='purge')
          db.prepare("DELETE FROM lifecycle_previews WHERE json_extract(plan,'$.library')=? AND json_extract(plan,'$.rawId')=?")
            .run(plan.library,plan.rawId);
        db.exec('COMMIT');
        return view(task.get(id));
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }
    },
    freezeDatabasePurge(id,batchId,plan,files) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const current=task.get(id);
        const intent=current && JSON.parse(current.plan);
        if (!databaseFirst || current?.state!=='awaiting-export' || intent.action!=='purge' ||
            intent.rawId!==plan.rawId || intent.library!==plan.library || intent.documentId!==plan.evidence?.id)
          fail('operation_conflict','永久删除清单与已确认任务不匹配。');
        const encoded=JSON.stringify(plan);
        const existing=db.prepare('SELECT plan,contributionVersion FROM lifecycle_database_purges WHERE id=? AND batchId=?')
          .get(id,batchId);
        if (existing && existing.plan!==encoded) fail('content_conflict','不能替换已冻结的删除清单。');
        const initial={state:intent.archiveOp===null ? 'active' : intent.archiveOp ? 'archived' : 'unknown',
          archiveOp:intent.archiveOp ?? null,revision:intent.revision,signature:intent.signature};
        const evidence=JSON.stringify({initial,files});
        const previous=db.prepare('SELECT evidence FROM lifecycle_database_purge_contributions WHERE id=? AND batchId=?')
          .get(id,batchId);
        if (existing?.contributionVersion===1 && !previous) fail('operation_conflict','逐卡删除补丁的证据缺失。');
        if (previous && previous.evidence!==evidence) fail('content_conflict','不能替换逐卡删除补丁的证据。');
        if (existing && ![0,1].includes(existing.contributionVersion)) fail('operation_conflict','未知的删除补丁证据版本。');
        if (!existing) db.prepare('INSERT INTO lifecycle_database_purges (id,batchId,plan,contributionVersion) VALUES (?,?,?,1)')
          .run(id,batchId,encoded);
        else if (existing.contributionVersion===0) db.prepare(
          'UPDATE lifecycle_database_purges SET contributionVersion=1 WHERE id=? AND batchId=?').run(id,batchId);
        if (!previous) db.prepare('INSERT INTO lifecycle_database_purge_contributions VALUES (?,?,?)').run(id,batchId,evidence);
        db.exec('COMMIT');
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }
    },
    frozenDatabasePurge(id,batchId) {
      const row=db.prepare('SELECT plan FROM lifecycle_database_purges WHERE id=? AND batchId=?').get(id,batchId);
      return row ? JSON.parse(row.plan) : null;
    },
    databasePurgeContribution(id,batchId) {
      const row=db.prepare(`SELECT p.contributionVersion,c.evidence FROM lifecycle_database_purges p
        LEFT JOIN lifecycle_database_purge_contributions c USING(id,batchId)
        WHERE p.id=? AND p.batchId=?`).get(id,batchId);
      if (row && ![0,1].includes(row.contributionVersion)) fail('operation_conflict','未知的删除补丁证据版本。');
      if (row?.contributionVersion===1 && !row.evidence) fail('operation_conflict','逐卡删除补丁的证据缺失。');
      return row?.evidence ? JSON.parse(row.evidence) : null;
    },
    pendingDatabasePurges() {
      if (!databaseFirst) return [];
      return db.prepare(`SELECT * FROM lifecycle_tasks
        WHERE json_extract(plan,'$.action')='purge'
          AND state IN ('queued','running','needs-review','awaiting-export') ORDER BY started,id`).all().map(internal);
    },
    rawRecoveryTasks(library) {
      return db.prepare(`SELECT * FROM lifecycle_tasks
        WHERE json_extract(progress,'$.stage')='restore-from-raw'
          AND json_extract(plan,'$.library')=? AND json_extract(progress,'$.creation') IS NOT NULL
          AND state IN ('running','needs-review') ORDER BY started,id`).all(library).map(internal);
    },
    databaseCompensations(library) {
      return db.prepare(`SELECT * FROM lifecycle_tasks WHERE json_extract(plan,'$.library')=?
        AND json_extract(plan,'$.action')='compensate' AND json_extract(progress,'$.phase') IS NOT NULL
        AND state IN ('queued','running','needs-review','complete') ORDER BY started,id`).all(library).map(internal);
    },
    clearDatabaseCardPayload(library,rawId) {
      if (!databaseFirst) fail('outside_scope','控制库不是数据库优先任务库。');
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare("DELETE FROM lifecycle_previews WHERE json_extract(plan,'$.library')=? AND json_extract(plan,'$.rawId')=?")
          .run(library,rawId);
        db.prepare(`UPDATE lifecycle_tasks
          SET plan=json_remove(plan,'$.title','$.markdown'),
              state=CASE WHEN state IN ('queued','running','needs-review') THEN 'cancelled' ELSE state END,
              progress=CASE WHEN state IN ('queued','running','needs-review') THEN '{"stage":"card-permanently-removed"}' ELSE progress END
          WHERE json_extract(plan,'$.library')=? AND json_extract(plan,'$.rawId')=?
            AND json_extract(plan,'$.action') IN ('create','edit','archive','restore')`).run(library,rawId);
        db.exec('COMMIT');
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }
      db.exec('VACUUM');
      if (db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()?.busy!==0)
        fail('operation_pending','卡片操作副本尚未完成清理读回。');
    },
    beginDatabasePurge(id,batchId,commit) {
      const current=task.get(id);
      const frozen=db.prepare('SELECT plan FROM lifecycle_database_purges WHERE id=? AND batchId=?').get(id,batchId);
      if (!databaseFirst || !frozen || !current || !['awaiting-export','running','complete'].includes(current.state))
        fail('operation_conflict','缺少待结算的数据库删除清单。');
      if (current.state==='awaiting-export') {
        db.prepare("UPDATE lifecycle_tasks SET state='running',plan=?,progress=? WHERE id=?").run(
          frozen.plan,JSON.stringify({stage:'database-purge-cleanup',commit}),id);
      } else if (current.plan!==frozen.plan || JSON.parse(current.progress).commit!==commit) {
        fail('operation_conflict','永久删除清单与现有清理状态不符。');
      }
      return internal(task.get(id));
    },
    status(owner, id) {
      const entry = task.get(id);
      if (entry?.owner !== ownerKey(owner)) fail('not_found', '操作不存在。');
      return view(entry);
    },
    owned(owner,id) {
      const row = task.get(id);
      if (row?.owner !== ownerKey(owner)) fail('not_found','操作不存在。');
      return internal(row);
    },
    next() {
      const row = db.prepare(`SELECT * FROM lifecycle_tasks WHERE state IN ('queued', 'running')
        AND json_extract(progress,'$.stage') IS NOT 'database-purge-cleanup' ORDER BY started,id LIMIT 1`).get();
      return row ? internal(row) : null;
    },
    get(id) {
      const row = task.get(id);
      return row ? internal(row) : null;
    },
    hasUnfinished() {
      return Boolean(db.prepare("SELECT 1 FROM lifecycle_tasks WHERE state NOT IN ('complete','cancelled') LIMIT 1").get());
    },
    update(id, state, progress) {
      if (!states.has(state)) fail('invalid_input', '未知任务状态。');
      const row = task.get(id);
      if (!row || ['complete', 'cancelled'].includes(row.state)) fail('operation_conflict', '任务已经结束或不存在。');
      db.prepare('UPDATE lifecycle_tasks SET state = ?, progress = ? WHERE id = ?').run(state, JSON.stringify(progress), id);
      return view(task.get(id));
    },
    finishSettlement(id,originalId,state,progress,settlement) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const original = task.get(originalId), row = task.get(id);
        if (original?.state !== 'needs-review' || row?.state !== 'running' || row.owner !== original.owner)
          fail('operation_conflict','原操作的结算状态已变化。');
        const write = db.prepare('UPDATE lifecycle_tasks SET state = ?, progress = ? WHERE id = ?');
        write.run(state,JSON.stringify(progress),originalId);
        write.run('complete',JSON.stringify(settlement),id);
        db.exec('COMMIT');
        return view(task.get(id));
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }
    },
    finishDatabaseCompensation(id,originalId,settlement) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const original=task.get(originalId), current=task.get(id);
        const plan=current && JSON.parse(current.plan), originalPlan=original && JSON.parse(original.plan);
        if (!databaseFirst || !original || current?.state!=='running' || plan.originalId!==originalId ||
            plan.library!==originalPlan.library || plan.rawId!==originalPlan.rawId ||
            !['awaiting-export','running','needs-review'].includes(original.state))
          fail('operation_conflict','撤销任务与原删除状态不一致。');
        const write=db.prepare('UPDATE lifecycle_tasks SET state=?,progress=? WHERE id=?');
        write.run('cancelled',JSON.stringify({settlementId:id}),originalId);
        write.run('complete',JSON.stringify(settlement),id);
        db.exec('COMMIT');
        return view(task.get(id));
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }
    },
    close() { db.close(); },
  };
}
