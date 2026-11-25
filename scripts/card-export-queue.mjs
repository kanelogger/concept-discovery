import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fail } from '../lib/siyuan.mjs';

const interval = 4 * 60 * 60 * 1000;
const rawIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const opIdPattern = /^[a-zA-Z0-9_-]{1,100}$/;
const documentPattern = /^\d{14}-[a-z0-9]{7}$/;
const revisionPattern = /^[a-f0-9]{64}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const actions = new Set(['create','edit','archive','restore','purge']);
const boundaryAfter = time => Math.floor(time/interval)*interval+interval;

/** DB-first write intents and their four-hour Git export batches. */
export function openCardExportQueue(filename,{now=Date.now}={}) {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA synchronous = FULL;
    PRAGMA secure_delete = ON;
    CREATE TABLE IF NOT EXISTS card_export_intents (
      sequence INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, library TEXT NOT NULL,
      rawId TEXT NOT NULL, action TEXT NOT NULL, expectedRevision TEXT, requestHash TEXT, path TEXT,
      state TEXT NOT NULL CHECK(state IN ('prepared','pending','batched','needs-review','complete','cancelled')),
      dueAt INTEGER NOT NULL, documentId TEXT, revision TEXT, batchId TEXT,
      errorCode TEXT, cleanupHead TEXT
    ) STRICT;
    CREATE TABLE IF NOT EXISTS card_export_batches (
      id TEXT PRIMARY KEY, library TEXT NOT NULL, boundary INTEGER NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('running','blocked','complete','superseded')),
      parent TEXT NOT NULL, candidate TEXT, errorCode TEXT, finishedAt INTEGER, sendStarted INTEGER, scope TEXT,
      UNIQUE(library,boundary)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS card_export_health (
      library TEXT PRIMARY KEY, errorCode TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS card_export_originals (
      library TEXT NOT NULL, rawId TEXT NOT NULL, path TEXT NOT NULL, rawHash TEXT NOT NULL,
      revision TEXT NOT NULL, commitHash TEXT NOT NULL, PRIMARY KEY(library,rawId)
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS one_open_card_export_batch
      ON card_export_batches (library) WHERE state IN ('running','blocked');`);
  if (!db.prepare('PRAGMA table_info(card_export_intents)').all().some(column=>column.name==='path'))
    db.exec('ALTER TABLE card_export_intents ADD COLUMN path TEXT');
  if (!db.prepare('PRAGMA table_info(card_export_intents)').all().some(column=>column.name==='fromRaw'))
    db.exec('ALTER TABLE card_export_intents ADD COLUMN fromRaw INTEGER NOT NULL DEFAULT 0');
  if (!db.prepare('PRAGMA table_info(card_export_batches)').all().some(column=>column.name==='scope'))
    db.exec('ALTER TABLE card_export_batches ADD COLUMN scope TEXT');
  if (!db.prepare('PRAGMA table_info(card_export_batches)').all().some(column=>column.name==='reviewedHead'))
    db.exec('ALTER TABLE card_export_batches ADD COLUMN reviewedHead TEXT');
  if (!db.prepare('PRAGMA table_info(card_export_batches)').all().some(column=>column.name==='filePlan'))
    db.exec('ALTER TABLE card_export_batches ADD COLUMN filePlan TEXT');
  if (!db.prepare('PRAGMA table_info(card_export_batches)').all().some(column=>column.name==='filePlanVersion'))
    db.exec('ALTER TABLE card_export_batches ADD COLUMN filePlanVersion INTEGER NOT NULL DEFAULT 0');
  if (!db.prepare('PRAGMA table_info(card_export_batches)').all().some(column=>column.name==='compensatedPaths'))
    db.exec("ALTER TABLE card_export_batches ADD COLUMN compensatedPaths TEXT NOT NULL DEFAULT '[]'");

  function verifySecureCheckpoint() {
    if (db.prepare('PRAGMA secure_delete').get().secure_delete!==1 ||
        db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get().busy!==0)
      fail('operation_pending','私有原稿提醒副本尚未完成安全清理读回。');
  }
  const hadManualTable=db.prepare("SELECT 1 FROM sqlite_schema WHERE name='card_manual_originals' AND type='table'").get();
  db.exec(`CREATE TABLE IF NOT EXISTS card_manual_originals (
    id TEXT PRIMARY KEY, title TEXT, evidence TEXT, verifiedHead TEXT, reason TEXT, observedRemoval INTEGER NOT NULL DEFAULT 0
  ) STRICT`);
  // A previous version could leave deleted reminder contents in free space or in WAL frames.
  // Compact that version once before recording a successful physical checkpoint.
  db.exec('CREATE TABLE IF NOT EXISTS card_export_migrations (name TEXT PRIMARY KEY) STRICT');
  const restoreWal='restore-wal-after-manual-cleanup';
  const migration=name=>db.prepare('SELECT 1 FROM card_export_migrations WHERE name=?').get(name);
  function restoreJournalMode() {
    if (migration(restoreWal)) {
      if (db.prepare('PRAGMA journal_mode=WAL').get().journal_mode!=='wal')
        fail('operation_pending','等待恢复私有队列的 WAL 配置。');
      db.prepare('DELETE FROM card_export_migrations WHERE name=?').run(restoreWal);
    }
  }
  restoreJournalMode();
  if (!migration('secure-manual-payloads-v2')) {
    try {
      if (hadManualTable) db.exec('VACUUM');
      verifySecureCheckpoint();
      db.prepare("INSERT INTO card_export_migrations VALUES ('secure-manual-payloads-v2')").run();
    } catch (error) {
      db.close();
      throw error;
    }
  }
  function forgetManualTitle(id) {
    db.prepare('UPDATE card_manual_originals SET title=NULL WHERE id=? AND title IS NOT NULL').run(id);
    if (db.prepare('SELECT title FROM card_manual_originals WHERE id=?').get(id)?.title!=null)
      fail('operation_pending','私有提醒中仍有待删卡片标题。');
    verifySecureCheckpoint();
  }
  let manualOriginals=false;
  const pendingManual=db.prepare(`SELECT i.*,m.evidence,m.title,m.verifiedHead,m.reason,m.observedRemoval
    FROM card_export_intents i LEFT JOIN card_manual_originals m USING(id)
    WHERE i.library=? AND i.action='purge' AND i.state NOT IN ('complete','cancelled') ORDER BY sequence`);
  const currentIntent = db.prepare('SELECT * FROM card_export_intents WHERE id=?');
  const currentBatch = db.prepare('SELECT * FROM card_export_batches WHERE id=?');
  const openBatch = db.prepare("SELECT * FROM card_export_batches WHERE library=? AND state IN ('running','blocked')");
  const pendingPurge = db.prepare(`SELECT * FROM card_export_intents
    WHERE library=? AND rawId=? AND action='purge' AND state NOT IN ('complete','cancelled') ORDER BY sequence LIMIT 1`);
  const members = db.prepare("SELECT * FROM card_export_intents WHERE batchId=? AND state<>'cancelled' ORDER BY sequence");
  const eligible = db.prepare(`SELECT sequence,action FROM card_export_intents AS candidate
    WHERE library=? AND state='pending' AND dueAt<=?
      AND (?=0 OR NOT EXISTS (SELECT 1 FROM card_export_intents p WHERE p.library=candidate.library
        AND p.rawId=candidate.rawId AND p.action='purge' AND p.state<>'cancelled'))
      AND NOT EXISTS (SELECT 1 FROM card_export_intents AS later
        WHERE later.library=candidate.library AND later.rawId=candidate.rawId
          AND (later.state IN ('prepared','needs-review') OR (later.state='pending' AND later.dueAt>?)))
    ORDER BY sequence`);
  const usedBoundary=db.prepare('SELECT 1 FROM card_export_batches WHERE library=? AND boundary=?');
  const byId = id => currentIntent.get(id) ?? null;
  const cancelledPurges=db.prepare("SELECT rawId FROM card_export_intents WHERE batchId=? AND action='purge' AND state='cancelled'");
  const view = row => ({...row,scope:row.scope ? JSON.parse(row.scope) : null,
    compensatedPaths:JSON.parse(row.compensatedPaths),
    compensatedRawIds:cancelledPurges.all(row.id).map(({rawId})=>rawId),changes:members.all(row.id)});

  function transaction(fn,{exclusive=false}={}) {
    db.exec(exclusive ? 'BEGIN EXCLUSIVE' : 'BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  }

  // In WAL, a logical deletion can be durable while the main database still holds its old evidence.
  // The rollback-journal commit overwrites the main pages and unlinks its journal atomically.
  function eraseManualEvidence(fn) {
    const previous=db.prepare('PRAGMA journal_mode').get().journal_mode;
    const memory=previous==='memory' && filename===':memory:';
    if (previous==='wal') db.prepare('INSERT OR IGNORE INTO card_export_migrations VALUES (?)').run(restoreWal);
    try {
      if (!memory && db.prepare('PRAGMA journal_mode=DELETE').get().journal_mode!=='delete')
        fail('operation_pending','等待独占清理私有原稿提醒。');
      transaction(()=>{
        if (!memory && db.prepare('PRAGMA journal_mode').get().journal_mode!=='delete')
          fail('operation_pending','私有队列日志模式已变化，等待重新清理。');
        fn();
      },{exclusive:true});
      verifySecureCheckpoint();
    } catch (error) {
      if ([5,6].includes(error.errcode & 255)) fail('operation_pending','私有队列仍有其他读写者，等待安全清理。');
      throw error;
    } finally {
      if (previous==='wal') restoreJournalMode();
      else if (['persist','truncate','off','memory'].includes(previous) && !memory)
        db.exec('PRAGMA journal_mode='+previous);
    }
  }

  function requireBatch(id) {
    const batch = currentBatch.get(id);
    if (!batch) fail('not_found','同步批次不存在。');
    return batch;
  }
  function refreshOlderPending(intent,revision) {
    if (!revisionPattern.test(revision ?? '')) fail('invalid_input','撤销必须提供已读回的原生修订。');
    db.prepare(`UPDATE card_export_intents SET revision=? WHERE sequence=(
      SELECT MAX(sequence) FROM card_export_intents WHERE library=? AND rawId=? AND sequence<?
        AND state IN ('pending','needs-review'))`)
      .run(revision,intent.library,intent.rawId,intent.sequence);
  }

  return {
    prepare({id,library,rawId,action,expectedRevision=null,documentId=null,requestHash=null,path=null,fromRaw=false}) {
      if (typeof id !== 'string' || !opIdPattern.test(id) || typeof library !== 'string' || !library || library.length>300 ||
          typeof rawId !== 'string' || !rawIdPattern.test(rawId) || rawId.length>180 || !actions.has(action) ||
          (action==='create' ? expectedRevision!==null : !revisionPattern.test(expectedRevision ?? '')) ||
          (documentId!==null && !documentPattern.test(documentId)) || (requestHash!==null && !revisionPattern.test(requestHash)) ||
          (fromRaw && (action!=='restore' || !documentId || !requestHash)) ||
          (path!==null && (typeof path!=='string' || !/^[^\\/\x00-\x1f]+\/[a-z0-9]+(?:-[a-z0-9]+)*\/article\.md$/.test(path) ||
            path.startsWith('./') || path.startsWith('../'))))
        fail('invalid_input','同步意图缺少已核实的卡片标识或预期版本。');
      return transaction(()=>{
        const existing = byId(id);
        const deleting = pendingPurge.get(library,rawId);
        if (existing) {
          if (existing.library!==library || existing.rawId!==rawId || existing.action!==action ||
              existing.expectedRevision!==expectedRevision || existing.requestHash!==requestHash || existing.path!==path ||
              Boolean(existing.fromRaw)!==fromRaw ||
              (documentId && existing.documentId!==documentId))
            fail('operation_conflict','操作 ID 已与其他同步意图绑定。');
          if (existing.state==='cancelled' || (existing.state==='prepared' && deleting && deleting.id!==id))
            fail('operation_conflict','原操作已取消，或卡片正在等待彻底删除。');
          return existing;
        }
        if (deleting) fail('operation_conflict','卡片正在等待彻底删除。');
        if (db.prepare("SELECT 1 FROM card_export_intents WHERE library=? AND rawId=? AND action='purge' AND state='complete'")
          .get(library,rawId)) fail('operation_conflict','此卡片标识已永久删除。');
        if (action==='purge' && db.prepare(`SELECT 1 FROM card_export_intents c
          JOIN card_export_batches b ON c.batchId=b.id
          WHERE c.library=? AND c.rawId=? AND c.state='batched' AND b.sendStarted IS NOT NULL LIMIT 1`).get(library,rawId))
          fail('previous_export_conflict','此卡的上一个同步结果尚未核实，请在批次结算后重新预览。');
        const unresolved=db.prepare("SELECT 1 FROM card_export_intents WHERE library=? AND rawId=? AND state='prepared'")
          .get(library,rawId);
        if (unresolved) fail('operation_pending','先核对该卡片尚未完成的数据库写入。');
        db.prepare(`INSERT INTO card_export_intents
          (id,library,rawId,action,expectedRevision,requestHash,documentId,path,state,dueAt,fromRaw)
          VALUES (?,?,?,?,?,?,?,?,'prepared',?,?)`)
          .run(id,library,rawId,action,expectedRevision,requestHash,documentId,path,boundaryAfter(now()),Number(fromRaw));
        return byId(id);
      });
    },
    acknowledge(id,{documentId,revision}) {
      if (!documentPattern.test(documentId ?? '') || !revisionPattern.test(revision ?? ''))
        fail('invalid_input','同步意图需要写后的原生文档及版本。');
      return transaction(()=>{
        const intent=byId(id);
        if (!intent) fail('not_found','同步意图不存在。');
        if (intent.documentId && intent.documentId!==documentId)
          fail('operation_conflict','写后文档与同步意图的目标不同。');
        if (intent.state!=='prepared') {
          if (intent.documentId!==documentId || intent.revision!==revision)
            fail('operation_conflict','写后回执与已登记版本不同。');
          return intent;
        }
        db.prepare("UPDATE card_export_intents SET state='pending',documentId=?,revision=?,errorCode=NULL WHERE id=?")
          .run(documentId,revision,id);
        return byId(id);
      });
    },
    get:byId,
    enableManualOriginals() { manualOriginals=true; },
    manualPurges(library) {
      return pendingManual.all(library).map(row=>({...row,evidence:row.evidence && JSON.parse(row.evidence)}));
    },
    manualEligible(change) { return change.dueAt<=now(); },
    registerManual(id,title) {
      db.prepare('INSERT INTO card_manual_originals(id,title) VALUES (?,?) ON CONFLICT(id) DO NOTHING').run(id,title);
    },
    forgetManualTitle,
    freezeManual(id,evidence) {
      const stored=db.prepare('SELECT evidence FROM card_manual_originals WHERE id=?').get(id);
      const encoded=JSON.stringify(evidence);
      if (!stored || (stored.evidence && stored.evidence!==encoded)) fail('operation_conflict','手工删除范围已冻结。');
      db.prepare('UPDATE card_manual_originals SET evidence=? WHERE id=?').run(encoded,id);
    },
    reportManual(id,verifiedHead,reason=null,removed=false) {
      db.prepare(`UPDATE card_manual_originals SET verifiedHead=?,reason=?,observedRemoval=MAX(observedRemoval,?)
        WHERE id=?`).run(verifiedHead,reason,Number(removed),id);
    },
    completeManual(id,commit,relocated,observed=commit) {
      forgetManualTitle(id);
      return eraseManualEvidence(()=>{
        const change=byId(id);
        const manual=db.prepare('SELECT verifiedHead FROM card_manual_originals WHERE id=?').get(id);
        if (change?.action!=='purge' || change.state!=='pending' || change.batchId || manual?.verifiedHead!==observed)
          fail('operation_conflict','手工删除的主分支读回与原操作不符。');
        db.prepare(`UPDATE card_export_intents SET state='complete',cleanupHead=?,errorCode=NULL WHERE id=?`).run(commit,id);
        db.prepare(`UPDATE card_export_intents SET state='cancelled',errorCode=NULL WHERE library=? AND rawId=?
          AND sequence<? AND state IN ('pending','needs-review')`).run(change.library,change.rawId,change.sequence);
        db.prepare('DELETE FROM card_export_originals WHERE library=? AND rawId=?').run(change.library,change.rawId);
        for (const original of relocated) {
          const prior=db.prepare('SELECT rawHash FROM card_export_originals WHERE library=? AND rawId=?').get(change.library,original.rawId);
          if (prior && prior.rawHash!==original.previousHash && prior.rawHash!==original.rawHash) continue;
          db.prepare(`INSERT INTO card_export_originals VALUES (?,?,?,?,?,?) ON CONFLICT(library,rawId) DO UPDATE
            SET path=excluded.path,rawHash=excluded.rawHash,revision=excluded.revision,commitHash=excluded.commitHash`)
            .run(change.library,original.rawId,original.path,original.rawHash,original.revision,observed);
        }
        db.prepare('DELETE FROM card_manual_originals WHERE id=?').run(id);
      });
    },
    liveCards(library) {
      return db.prepare(`SELECT c.* FROM card_export_intents c
        WHERE c.sequence IN (SELECT MAX(sequence) FROM card_export_intents
          WHERE library=? AND state IN ('pending','batched','needs-review','complete') GROUP BY rawId)`).all(library);
    },
    published(library,rawId) {
      return db.prepare('SELECT path,rawHash,revision,commitHash FROM card_export_originals WHERE library=? AND rawId=?')
        .get(library,rawId) ?? null;
    },
    createdInDatabase(library,rawId) {
      return Boolean(db.prepare("SELECT 1 FROM card_export_intents WHERE library=? AND rawId=? AND action='create' AND state NOT IN ('prepared','cancelled')")
        .get(library,rawId));
    },
    createdWithoutOriginal(library,rawId,documentId,path) {
      return Boolean(db.prepare(`SELECT 1 FROM card_export_intents WHERE library=? AND rawId=? AND documentId=? AND path=?
        AND action='create' AND state NOT IN ('prepared','cancelled')`).get(library,rawId,documentId,path));
    },
    recoveredOriginal(library,rawId,documentId) {
      return db.prepare(`SELECT requestHash FROM card_export_intents WHERE library=? AND rawId=? AND documentId=?
        AND fromRaw=1 AND state NOT IN ('prepared','cancelled') ORDER BY sequence DESC LIMIT 1`)
        .get(library,rawId,documentId)?.requestHash ?? null;
    },
    outstanding(library,rawIds) {
      const select=db.prepare(`SELECT id,rawId,action,state,errorCode FROM card_export_intents
        WHERE library=? AND rawId=? AND state NOT IN ('complete','cancelled') ORDER BY sequence`);
      return [...new Set(rawIds)].flatMap(rawId=>select.all(library,rawId));
    },
    pendingPurge(library,rawId) {
      return pendingPurge.get(library,rawId) ?? null;
    },
    refreshPendingPurge(id,{documentId,previousRevision,revision}) {
      if (!revisionPattern.test(revision ?? '')) fail('invalid_input','需要已核实的归档修订。');
      return transaction(()=>{
        const current=byId(id);
        if (current?.action!=='purge' || current.state!=='pending' ||
            current.documentId!==documentId || current.revision!==previousRevision)
          fail('operation_conflict','待删修订与冷备重放不匹配。');
        db.prepare('UPDATE card_export_intents SET revision=? WHERE id=?').run(revision,id);
        return byId(id);
      });
    },
    activeBatch(library) {
      const row=openBatch.get(library);
      return row ? view(row) : null;
    },
    batch(library,id) {
      const row=currentBatch.get(id);
      return row?.library===library ? view(row) : null;
    },
    hasDue(library) {
      const boundary=boundaryAfter(now())-interval;
      return !usedBoundary.get(library,boundary) && Boolean(eligible.get(library,boundary,Number(manualOriginals),boundary));
    },
    maySettlePurge(library) {
      const batch=openBatch.get(library);
      if (batch) return members.all(batch.id).some(change=>change.action==='purge');
      const boundary=boundaryAfter(now())-interval;
      return !usedBoundary.get(library,boundary) && eligible.all(library,boundary,Number(manualOriginals),boundary).some(change=>change.action==='purge');
    },
    claimDue(library,parent) {
      if (!commitPattern.test(parent ?? '')) fail('invalid_input','同步批次需要已核实的 Git 父提交。');
      return transaction(()=>{
        const existing=openBatch.get(library);
        if (existing) return view(existing);
        const boundary=boundaryAfter(now())-interval;
        if (usedBoundary.get(library,boundary)) return null;
        const pending=eligible.all(library,boundary,Number(manualOriginals),boundary);
        if (!pending.length) return null;
        const id=randomUUID();
        db.prepare("INSERT INTO card_export_batches (id,library,boundary,state,parent) VALUES (?,?,?,'running',?)")
          .run(id,library,boundary,parent);
        const enroll=db.prepare("UPDATE card_export_intents SET state='batched',batchId=?,errorCode=NULL WHERE sequence=?");
        for (const {sequence} of pending) enroll.run(id,sequence);
        return view(requireBatch(id));
      });
    },
    claimAcceptance(library,parent,rawIds) {
      if (!commitPattern.test(parent ?? '') || !Array.isArray(rawIds) || !rawIds.length || rawIds.length>8 ||
          rawIds.some(value=>typeof value!=='string' || !rawIdPattern.test(value)))
        fail('invalid_input','手动验收批次需要明确的合成卡范围。');
      const scope=[...new Set(rawIds)].sort(), encoded=JSON.stringify(scope);
      return transaction(()=>{
        const existing=openBatch.get(library);
        if (existing) {
          if (existing.scope!==encoded) fail('operation_pending','先结算现有批次。');
          return view(existing);
        }
        const card=db.prepare(`SELECT sequence,action,state FROM card_export_intents
          WHERE library=? AND rawId=? ORDER BY sequence`);
        const pending=[];
        for (const rawId of scope) {
          const history=card.all(library,rawId);
          if (manualOriginals && history.some(item=>item.action==='purge' && item.state!=='cancelled')) continue;
          if (!history.some(item=>item.action==='create' && !['prepared','cancelled'].includes(item.state)) ||
              history.some(item=>['prepared','needs-review'].includes(item.state)))
            fail('outside_scope','验收只能处理已由数据库创建且没有未核对写入的卡片。');
          pending.push(...history.filter(item=>item.state==='pending'));
        }
        if (!pending.length) return null;
        const minimum=db.prepare('SELECT MIN(boundary) AS value FROM card_export_batches WHERE library=? AND boundary<0').get(library);
        const id=randomUUID();
        db.prepare("INSERT INTO card_export_batches (id,library,boundary,state,parent,scope) VALUES (?,?,?,'running',?,?)")
          .run(id,library,(minimum.value ?? 0)-1,parent,encoded);
        const enroll=db.prepare("UPDATE card_export_intents SET state='batched',batchId=?,errorCode=NULL WHERE sequence=?");
        for (const {sequence} of pending) enroll.run(id,sequence);
        return view(requireBatch(id));
      });
    },
    reportWriteError(id,reason) {
      if (!/^[a-z][a-z0-9_]{0,60}$/.test(reason ?? '')) fail('invalid_input','写入异常代码无效。');
      const affected=db.prepare("UPDATE card_export_intents SET errorCode=? WHERE id=? AND state='prepared'").run(reason,id);
      if (!affected.changes) fail('operation_conflict','只有待核实的写入可以记录异常。');
      return byId(id);
    },
    // The coordinator must prove that the exact native operation never wrote.
    abandonUnwritten(id,{operationId,state}) {
      if (operationId!=='db-card-'+id || state!=='sealed-unwritten')
        fail('operation_conflict','必须核实原生操作尚未写入，才能取消同步意图。');
      return transaction(()=>{
        const intent=byId(id);
        if (intent?.state==='cancelled') return intent;
        if (intent?.state!=='prepared' || intent.action==='purge')
          fail('operation_conflict','不能取消已有写入或分享暂停的同步意图。');
        db.prepare("UPDATE card_export_intents SET state='cancelled',errorCode=NULL WHERE id=?").run(id);
        return byId(id);
      });
    },
    freezeBatchFiles(id,files) {
      return transaction(()=>{
        const batch=requireBatch(id);
        if (batch.state!=='running' || batch.candidate || batch.sendStarted!==null)
          fail('operation_conflict','已有候选的同步批次不能替换文件清单。');
        db.prepare('UPDATE card_export_batches SET filePlan=?,filePlanVersion=1 WHERE id=?').run(JSON.stringify(files),id);
      });
    },
    recordCandidate(id,commit) {
      if (!commitPattern.test(commit ?? '')) fail('invalid_input','需要同步候选提交的完整标识。');
      return transaction(()=>{
        const batch=requireBatch(id);
        if (batch.state!=='running' || (batch.candidate && batch.candidate!==commit))
          fail('operation_conflict','不能替换已冻结的同步候选。');
        db.prepare('UPDATE card_export_batches SET candidate=? WHERE id=?').run(commit,id);
        return view(requireBatch(id));
      });
    },
    beginSend(id,candidate) {
      return transaction(()=>{
        const batch=requireBatch(id);
        if (batch.state!=='running' || !candidate || batch.candidate!==candidate)
          fail('operation_conflict','准备发送的原稿与冻结候选不同。');
        const pendingDeletion=db.prepare(`SELECT 1 FROM card_export_intents frozen
          JOIN card_export_intents pending ON pending.library=frozen.library AND pending.rawId=frozen.rawId
          WHERE frozen.batchId=? AND frozen.state='batched' AND pending.action='purge' AND pending.sequence>frozen.sequence
            AND pending.state<>'cancelled' AND (pending.batchId IS NULL OR pending.batchId<>?) LIMIT 1`)
          .get(id,id);
        if (pendingDeletion) fail('newer_purge_pending','卡片确认待删，旧候选不能发送。');
        db.prepare('UPDATE card_export_batches SET sendStarted=COALESCE(sendStarted,?) WHERE id=?').run(now(),id);
        return view(requireBatch(id));
      });
    },
    reportPreflight(library,reason) {
      if (reason===null) { db.prepare('DELETE FROM card_export_health WHERE library=?').run(library); return; }
      if (!/^[a-z][a-z0-9_]{0,60}$/.test(reason ?? '')) fail('invalid_input','同步异常代码无效。');
      db.prepare(`INSERT INTO card_export_health VALUES (?,?)
        ON CONFLICT(library) DO UPDATE SET errorCode=excluded.errorCode`).run(library,reason);
    },
    requeueReviewed(library,rawId) {
      return transaction(()=>{
        if (openBatch.get(library)) fail('operation_pending','请先核对正在同步的批次。');
        const changed=db.prepare(`UPDATE card_export_intents SET state='pending',errorCode=NULL,dueAt=?
          WHERE library=? AND rawId=? AND state='needs-review'`).run(boundaryAfter(now()),library,rawId);
        if (!changed.changes) fail('not_found','没有需要核对的同步冲突。');
        return changed.changes;
      });
    },
    supersede(id,observed) {
      return transaction(()=>{
        const batch=requireBatch(id);
        const unstaged=!batch.candidate && !observed.commit && observed.state==='conflict';
        const sameCandidate=batch.candidate && observed.commit===batch.candidate;
        // A send with unknown outcome is never discarded while the old lease
        // can still succeed. A verified fast-forward of that lease invalidates it.
        const provenUnpublished=unstaged || (sameCandidate &&
          ((observed.state==='prepared' && batch.sendStarted===null && observed.head===batch.parent) ||
           (observed.state==='conflict' && observed.head!==batch.parent)));
        if (!['running','blocked'].includes(batch.state) || !commitPattern.test(observed.head ?? '') || !provenUnpublished)
          fail('operation_conflict','尚未证明原同步候选未发布。');
        db.prepare("UPDATE card_export_intents SET state='pending',batchId=NULL WHERE batchId=? AND state='batched'").run(id);
        db.prepare("UPDATE card_export_batches SET state='superseded' WHERE id=?").run(id);
        return view(requireBatch(id));
      });
    },
    block(id,reason) {
      if (!/^[a-z][a-z0-9_]{0,60}$/.test(reason ?? '')) fail('invalid_input','同步异常代码无效。');
      return transaction(()=>{
        const batch=requireBatch(id);
        if (!['running','blocked'].includes(batch.state)) fail('operation_conflict','同步批次已结束。');
        db.prepare("UPDATE card_export_batches SET state='blocked',errorCode=? WHERE id=?").run(reason,id);
        return view(requireBatch(id));
      });
    },
    resume(id) {
      return transaction(()=>{
        const batch=requireBatch(id);
        if (batch.state!=='blocked') fail('operation_conflict','只有待核对的批次可以继续。');
        db.prepare("UPDATE card_export_batches SET state='running',errorCode=NULL WHERE id=?").run(id);
        return view(requireBatch(id));
      });
    },
    approvePublishedHead(id,candidate,head) {
      if (!commitPattern.test(head ?? '')) fail('invalid_input','缺少重新核对的主分支头部。');
      return transaction(()=>{
        const batch=requireBatch(id);
        if (batch.candidate!==candidate || !batch.sendStarted || !['running','blocked','complete'].includes(batch.state))
          fail('content_conflict','批次与重新预览时不符。');
        if (batch.reviewedHead===head) return view(batch);
        if (batch.state!=='blocked') fail('content_conflict','批次已进入其他处理阶段。');
        db.prepare("UPDATE card_export_batches SET state='running',errorCode=NULL,reviewedHead=? WHERE id=?").run(head,id);
        return view(requireBatch(id));
      });
    },
    deferCard(id,rawId,reason,{nextBoundary=false}={}) {
      if (!/^[a-z][a-z0-9_]{0,60}$/.test(reason ?? '')) fail('invalid_input','同步异常代码无效。');
      return transaction(()=>{
        const batch=requireBatch(id);
        if (batch.state!=='running' || batch.candidate)
          fail('operation_conflict','只能在冻结同步候选前排除冲突的卡片。');
        const result=db.prepare(`UPDATE card_export_intents
          SET state=?,errorCode=?,batchId=NULL,dueAt=CASE WHEN ? THEN ? ELSE dueAt END
          WHERE batchId=? AND rawId=? AND state='batched'`)
          .run(nextBoundary?'pending':'needs-review',reason,Number(nextBoundary),boundaryAfter(now()),id,rawId);
        if (!result.changes) fail('not_found','此批次中找不到该卡片。');
        return view(requireBatch(id));
      });
    },
    recordPurgeCleanup(id,observedGitHead) {
      return transaction(()=>{
        const intent=byId(id);
        const batch=intent?.batchId && currentBatch.get(intent.batchId);
        if (!batch || intent.action!=='purge' || intent.state!=='batched' || !batch.candidate || batch.candidate!==observedGitHead)
          fail('operation_conflict','永久清理回执与批次不符。');
        if (intent.cleanupHead && intent.cleanupHead!==observedGitHead)
          fail('operation_conflict','永久清理回执已登记。');
        db.prepare('UPDATE card_export_intents SET cleanupHead=? WHERE id=?').run(observedGitHead,id);
        return byId(id);
      });
    },
    cancelPurge(id,{library,batchId,candidate,paths,revision}) {
      return transaction(()=>{
        const intent=byId(id);
        if (intent?.library!==library || intent.action!=='purge' || intent.cleanupHead)
          fail('operation_conflict','不能撤销该待删项。');
        if (intent.state==='cancelled') return refreshOlderPending(intent,revision);
        if (intent.batchId!==batchId || !(batchId ? intent.state==='batched' : ['pending','needs-review'].includes(intent.state)))
          fail('operation_conflict','撤销时同步队列归属已变化。');
        if (batchId) {
          const batch=requireBatch(batchId);
          if (!['running','blocked'].includes(batch.state) || batch.candidate!==candidate)
            fail('operation_conflict','撤销时同步批次已变化。');
          const compensated=[...new Set([...JSON.parse(batch.compensatedPaths),...paths])].sort();
          db.prepare("UPDATE card_export_batches SET compensatedPaths=?,state='running',errorCode=NULL,reviewedHead=NULL WHERE id=?")
            .run(JSON.stringify(compensated),batchId);
        }
        db.prepare("UPDATE card_export_intents SET state='cancelled',errorCode=NULL WHERE id=?").run(id);
        db.prepare(`UPDATE card_export_intents SET state='pending',batchId=NULL,errorCode=NULL,dueAt=?
          WHERE library=? AND rawId=? AND sequence<? AND state='batched'`)
          .run(boundaryAfter(now()),intent.library,intent.rawId,intent.sequence);
        db.prepare('DELETE FROM card_manual_originals WHERE id=?').run(id);
        refreshOlderPending(intent,revision);
      });
    },
    refreshCompensatedRevision(id,revision) {
      return transaction(()=>{
        const intent=byId(id);
        if (intent?.action!=='purge' || intent.state!=='cancelled')
          fail('operation_conflict','没有可核实的撤销回放。');
        db.prepare('DELETE FROM card_manual_originals WHERE id=?').run(id);
        refreshOlderPending(intent,revision);
      });
    },
    complete(id,observed,{originals=[],relocated=[],conflictingRawIds=[]}={}) {
      return transaction(()=>{
        const batch=requireBatch(id);
        if (batch.state==='superseded' || !batch.candidate || batch.candidate!==observed)
          fail('operation_conflict','尚未读回该批次的 Git 候选。');
        if (batch.state!=='complete') {
          const changes=members.all(id);
          if (changes.some(change=>change.action==='purge' && change.cleanupHead!==observed))
            fail('operation_pending','仍有永久删除尚未完成线上清理读回。');
          const newest=new Map(changes.map(change=>[change.rawId,change]));
          if (conflictingRawIds.some(rawId=>!newest.has(rawId) || newest.get(rawId).action==='purge'))
            fail('operation_conflict','发布后冲突范围和已核实批次不符。');
          const record=db.prepare(`INSERT INTO card_export_originals VALUES (?,?,?,?,?,?)
            ON CONFLICT(library,rawId) DO UPDATE SET path=excluded.path,rawHash=excluded.rawHash,
              revision=excluded.revision,commitHash=excluded.commitHash`);
          for (const {rawId,path,rawHash,revision} of originals) {
            const change=newest.get(rawId);
            if (!change || change.action==='purge' || revision!==change.revision || !revisionPattern.test(rawHash ?? '') || !path)
              fail('operation_conflict','发布原稿与批次冻结版本不符。');
            record.run(batch.library,rawId,path,rawHash,revision,observed);
          }
          for (const {rawId,path,rawHash,revision} of relocated) {
            if (newest.has(rawId) || !changes.some(change=>change.action==='purge') ||
                !revisionPattern.test(revision ?? '') || !revisionPattern.test(rawHash ?? '') || !path)
              fail('operation_conflict','共享附件迁移涉及未核实的原稿。');
            record.run(batch.library,rawId,path,rawHash,revision,observed);
          }
          for (const change of changes.filter(item=>item.action==='purge'))
            db.prepare('DELETE FROM card_export_originals WHERE library=? AND rawId=?').run(batch.library,change.rawId);
          db.prepare("UPDATE card_export_intents SET state='complete' WHERE batchId=? AND state='batched'").run(id);
          const recheck=db.prepare(`UPDATE card_export_intents SET state='needs-review',batchId=NULL,errorCode='git_content_conflict'
            WHERE batchId=? AND rawId=? AND state='complete'`);
          for (const rawId of conflictingRawIds) recheck.run(id,rawId);
          db.prepare("UPDATE card_export_batches SET state='complete',errorCode=NULL,finishedAt=? WHERE id=?")
            .run(newest.size>new Set(conflictingRawIds).size ? now() : null,id);
        }
        return view(requireBatch(id));
      });
    },
    summary(library) {
      const last=db.prepare("SELECT MAX(finishedAt) AS time FROM card_export_batches WHERE library=? AND state='complete'").get(library);
      const pending=db.prepare("SELECT COUNT(*) AS count FROM card_export_intents WHERE library=? AND state NOT IN ('complete','cancelled')").get(library);
      const batch=openBatch.get(library);
      const issues=db.prepare(`SELECT rawId,errorCode AS code,MAX(state='needs-review') AS retryable FROM card_export_intents
        WHERE library=? AND state IN ('prepared','needs-review','pending') AND errorCode IS NOT NULL
        GROUP BY rawId,errorCode ORDER BY rawId,code`).all(library)
        .map(({rawId,code,retryable})=>({rawId,code,...(retryable && {retryable:true})}));
      const preflight=db.prepare('SELECT errorCode AS code FROM card_export_health WHERE library=?').get(library);
      return {lastSuccessAt:last.time,nextBatchAt:boundaryAfter(now()),pendingCount:pending.count,
        issues,
        ...(batch?.state==='blocked' ? {issue:{batchId:batch.id,code:batch.errorCode,
          canReviewPublished:batch.errorCode==='content_conflict' && Boolean(batch.sendStarted) &&
            members.all(batch.id).some(change=>change.action==='purge' && !change.cleanupHead),
          rawIds:[...new Set(members.all(batch.id).map(change=>change.rawId))]}} : preflight ? {issue:{code:preflight.code}} : {})};
    },
    close() { db.close(); },
  };
}
