import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { closeSync, openSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonical, fail } from '../lib/siyuan.mjs';
import { fetchBranchHead, readBranchCommit } from './github-branch-reader.mjs';

const sha = /^[a-f0-9]{40}$/;
const digest = /^[a-f0-9]{64}$/;
const operation = /^[a-zA-Z0-9_-]{1,100}$/;
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const documentId = /^\d{14}-[a-z0-9]{7}$/;
const encode = value => JSON.stringify(canonical(value));

export function validateDecision(value) {
  if (!value || typeof value !== 'object') fail('invalid_input', '缺少删除决定。');
  const { version, opId, library, rawId, previewDigest, mainCommit, documents, outcome } = value;
  if (version !== 1 || typeof opId !== 'string' || !operation.test(opId) || typeof library !== 'string' || !library || library.length > 300 ||
      typeof rawId !== 'string' || !slug.test(rawId) || typeof previewDigest !== 'string' || !digest.test(previewDigest) ||
      typeof mainCommit !== 'string' || !sha.test(mainCommit) ||
      !Array.isArray(documents) || !documents.length || documents.length > 1000 ||
      !documents.every(id => typeof id === 'string' && documentId.test(id)) || new Set(documents).size !== documents.length ||
      (outcome !== undefined && outcome !== 'cancelled'))
    fail('invalid_input', '删除决定的身份、提交或文档标识无效。');
  const normalized = { version, opId, library, rawId, previewDigest, mainCommit, documents, ...(outcome && {outcome}) };
  if (encode(value) !== encode(normalized)) fail('invalid_input', '删除账本只能记录规定的无正文数据。');
  return normalized;
}

// The native cleaner calls validateDecision directly. Only content publishing
// and the independent append checker understand public-ID decisions.
export function validateSignedDecision(value) {
  if (value?.version !== 2) return validateDecision(value);
  const {version,opId,library,publicId,publicationSha256,sourceCommit,outcome} = value;
  if (typeof opId !== 'string' || !operation.test(opId) || typeof library !== 'string' ||
      !library.trim() || library.length > 300 || typeof publicId !== 'string' || !slug.test(publicId) ||
      typeof publicationSha256 !== 'string' || !digest.test(publicationSha256) ||
      typeof sourceCommit !== 'string' || !sha.test(sourceCommit) || (outcome !== undefined && outcome !== 'cancelled'))
    fail('invalid_input','公开主卡删除决定的身份或发布依据无效。');
  const record = {version,opId,library,publicId,publicationSha256,sourceCommit,...(outcome && {outcome})};
  if (encode(record) !== encode(value)) fail('invalid_input','公开主卡删除决定含额外字段。');
  return record;
}

const recordPath = opId => `decisions/${opId}.json`;

// The journal must live outside the knowledge cold backup. The host worker
// serializes calls and verifies the current Git and native document preflight.
export function openGitDeletionLedger({ cwd, remote, branch, anchor, journalPath, initialHead, signingKey, allowedSignersFile,
  beforePush, readBranch }) {
  if (!sha.test(anchor ?? '') || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(remote ?? '') ||
      !/^[-a-zA-Z0-9_/]+$/.test(branch ?? '') || branch.startsWith('-') || !journalPath ||
      Boolean(signingKey) !== Boolean(allowedSignersFile)) fail('invalid_input', '缺少有效的 Git 账本配置。');
  const ref = `refs/heads/${branch}`;
  const tracking = `refs/concept-deletion/${remote}/${branch}`;
  function git(args, options) {
    const signing = signingKey ? ['-c', 'gpg.format=ssh', '-c', `user.signingkey=${signingKey}`,
      '-c', `gpg.ssh.allowedSignersFile=${allowedSignersFile}`] : [];
    return execFileSync('git', [...signing, ...args], { cwd, encoding: 'utf8', timeout: 30000,
      maxBuffer: 8 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...options }).trim();
  }
  git(['check-ref-format', ref]);
  if (initialHead !== undefined) {
    if (typeof initialHead !== 'string' || !sha.test(initialHead)) fail('invalid_input', '初始化须提供独立核实的账本头部。');
    closeSync(openSync(journalPath, 'wx', 0o600));
  } else {
    // SQLite creates missing files automatically; recovery must require the original journal.
    closeSync(openSync(journalPath, 'r+'));
  }
  const db = new DatabaseSync(journalPath);
  db.exec(`PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS deletion_ledger_head (ref TEXT PRIMARY KEY, sha TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS lifecycle_git_readback (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1), request_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deletion_ledger_pending (
      ref TEXT NOT NULL, op_id TEXT NOT NULL, decision TEXT NOT NULL, parent TEXT NOT NULL,
      candidate TEXT NOT NULL, attempted INTEGER NOT NULL DEFAULT 0, cancel_requested INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (ref, op_id)
    );`);
  const checkpoint = db.prepare('SELECT sha FROM deletion_ledger_head WHERE ref = ?');
  const recordHead = db.prepare('INSERT INTO deletion_ledger_head VALUES (?, ?) ON CONFLICT(ref) DO UPDATE SET sha=excluded.sha');
  const pendingRow = db.prepare('SELECT * FROM deletion_ledger_pending WHERE ref = ? AND op_id = ?');
  const pendingList = db.prepare('SELECT op_id AS opId, parent, candidate FROM deletion_ledger_pending WHERE ref = ? ORDER BY op_id');
  const uncertain = db.prepare('SELECT 1 FROM deletion_ledger_pending WHERE ref = ? AND (attempted = 1 OR cancel_requested = 1) LIMIT 1');
  const persistPending = db.prepare(`INSERT INTO deletion_ledger_pending (ref, op_id, decision, parent, candidate) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(ref, op_id) DO UPDATE SET parent=excluded.parent, candidate=excluded.candidate,
      attempted=CASE WHEN deletion_ledger_pending.parent=excluded.parent THEN deletion_ledger_pending.attempted ELSE 0 END`);
  const markAttempted = db.prepare('UPDATE deletion_ledger_pending SET attempted = 1 WHERE ref = ? AND op_id = ?');
  const markCancellation = db.prepare('UPDATE deletion_ledger_pending SET cancel_requested = 1 WHERE ref = ? AND op_id = ?');
  const clearPending = db.prepare('DELETE FROM deletion_ledger_pending WHERE ref = ? AND op_id = ?');
  const readbackRequest = db.prepare('SELECT request_id FROM lifecycle_git_readback WHERE singleton=1');
  const recordReadback = db.prepare('INSERT OR REPLACE INTO lifecycle_git_readback VALUES (1,?)');
  const clearReadback = db.prepare('DELETE FROM lifecycle_git_readback WHERE singleton=1 AND request_id=?');
  if (initialHead !== undefined) recordHead.run(ref, initialHead);
  if (!checkpoint.get(ref)) {
    db.close();
    fail('ledger_changed', '控制记录中没有已信任的账本头部。');
  }

  function verifyHead(head,previousTracking) {
    const floor = checkpoint.get(ref).sha;
    const commits = git(['rev-list', '--first-parent', '--reverse', `${anchor}..${head}`]).split('\n').filter(Boolean);
    let parent = anchor;
    const decisions = new Map();
    for (const commit of commits) {
      if (git(['show', '-s', '--format=%P', commit]) !== parent) fail('ledger_changed', '账本头部与已信任历史不连续。');
      if (allowedSignersFile) git(['verify-commit', commit]);
      const change = /^A\tdecisions\/([a-zA-Z0-9_-]{1,100})\.json$/.exec(
        git(['diff-tree', '--no-commit-id', '--name-status', '-r', parent, commit]));
      if (!change) fail('ledger_changed', '账本提交不是单条追加。');
      const opId = change[1];
      const decision = validateDecision(JSON.parse(git(['show', `${commit}:${recordPath(opId)}`])));
      if (decision.opId !== opId || decisions.has(opId)) fail('ledger_changed', '账本操作 ID 不一致或重复。');
      decisions.set(opId, { decision, commit });
      parent = commit;
    }
    if (parent !== head || (floor !== anchor && !commits.includes(floor)))
      fail('ledger_changed', '远端账本旧于已确认的版本，或属于另一条历史。');
    if (previousTracking!==undefined) git(['update-ref',tracking,head,previousTracking || '0'.repeat(40)]);
    recordHead.run(ref, head);
    return { head, decisions };
  }

  function snapshot() {
    return verifyHead(fetchBranchHead(git,remote,ref,tracking));
  }

  function requireReady({allowUnsent=false}={}) {
    if (allowUnsent ? uncertain.get(ref) : pendingList.all(ref).length)
      fail('ledger_pending', '须先结算已持久化的待办，才能开放服务。');
  }

  function readySnapshot(options) {
    requireReady(options);
    return snapshot();
  }

  function requireCompletedReadback() {
    if (readbackRequest.get()) fail('operation_pending','主动维护后的 Git 完整核对尚未完成。');
  }

  async function finishGitReadback(verify) {
    const request=readbackRequest.get();
    const result=await verify();
    if (request) clearReadback.run(request.request_id);
    requireCompletedReadback();
    return result;
  }

  async function verifyForServing(verifyGit,verifyReady) {
    if (readbackRequest.get()) return finishGitReadback(verifyGit);
    const result=await verifyReady();
    requireCompletedReadback();
    return result;
  }

  async function readReadySnapshot(options) {
    requireCompletedReadback();
    if (!readBranch) return readySnapshot(options);
    requireReady(options);
    const previous=git(['for-each-ref','--format=%(objectname)',tracking]);
    const head=await readBranchCommit({git,remote,branch,readBranch,destination:'refs/concept-deletion-fetch/'+remote+'/'+branch});
    requireCompletedReadback();
    requireReady(options);
    return verifyHead(head,previous);
  }

  function stage(decision, head) {
    const directory = mkdtempSync(join(tmpdir(), 'cd-ledger-'));
    try {
      const env = { ...process.env, GIT_INDEX_FILE: join(directory, 'index') };
      const content = encode(decision);
      git(['read-tree', head], { env });
      const blob = git(['hash-object', '-w', '--stdin'], { input: `${content}\n` });
      git(['update-index', '--add', '--cacheinfo', `100644,${blob},${recordPath(decision.opId)}`], { env });
      const tree = git(['write-tree'], { env });
      const candidate = git(['commit-tree', tree, '-p', head, ...(signingKey ? ['-S'] : []),
        '-m', `Record deletion ${decision.opId}`]);
      persistPending.run(ref, decision.opId, content, head, candidate);
      return candidate;
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }

  function candidateAt(decision, pending, head) {
    if (pending?.parent === head && sha.test(pending.candidate)) {
      try {
        if (git(['show', '-s', '--format=%P', pending.candidate]) === head &&
            git(['show', `${pending.candidate}:${recordPath(decision.opId)}`]) === encode(decision)) return pending.candidate;
      } catch {
        // A new working clone or Git garbage collection may have lost the object.
      }
    }
    return stage(decision, head);
  }

  function validateCandidate(candidate, head, decision) {
    if (allowedSignersFile) git(['verify-commit', candidate]);
    if (git(['show', '-s', '--format=%P', candidate]) !== head ||
        git(['diff-tree', '--no-commit-id', '--name-status', '-r', head, candidate]) !== `A\t${recordPath(decision.opId)}` ||
        git(['show', `${candidate}:${recordPath(decision.opId)}`]) !== encode(decision))
      fail('ledger_changed', '候选提交不是对已核实头部的单条追加。');
  }

  function resolveDecision(decision, status) {
    const known = status.decisions.get(decision.opId);
    if (known) {
      const { outcome, ...approval } = known.decision;
      if (encode(approval) !== encode(decision)) fail('ledger_conflict', '该操作 ID 已用于另一项决定。');
    }
    return known;
  }

  const resolved = known => ({ state: known.decision.outcome === 'cancelled' ? 'cancelled' : 'committed', ...known });

  async function pushCandidate(decision, pending, head, recheck) {
    const candidate = candidateAt(decision, pending, head);
    validateCandidate(candidate, head, decision);
    if (beforePush) {
      await beforePush({candidate, parent:head, remote, git});
      if (snapshot().head !== head) fail('ledger_pending','等待校验期间账本已前进，请按原操作 ID 重试。');
      await recheck?.(decision);
    }
    markAttempted.run(ref, decision.opId);
    // The exact lease is a compare-and-swap. The verified candidate is a single fast-forward commit.
    try { git(['push', '--porcelain', `--force-with-lease=${ref}:${head}`, remote, `${candidate}:${ref}`]); }
    catch {
      // A timeout, remote rejection and a lost response are indistinguishable until readback.
    }
  }

  return {
    snapshot, readySnapshot, readReadySnapshot,
    beginGitReadback:()=>{recordReadback.run(randomUUID());},
    needsGitReadback:()=>Boolean(readbackRequest.get()),
    finishGitReadback, verifyForServing,
    recoverySnapshot({allowUnsent=false}={}) {
      const status = snapshot();
      for (const {opId} of pendingList.all(ref)) {
        const pending = pendingRow.get(ref,opId);
        const known = resolveDecision(validateDecision(JSON.parse(pending.decision)),status);
        if (!known && allowUnsent && !pending.attempted && !pending.cancel_requested) continue;
        if (!known || known.decision.outcome === 'cancelled')
          fail('ledger_pending','须先核实待办的永久删除决定。');
      }
      return status;
    },
    pending: () => pendingList.all(ref),
    prepare(value) {
      const decision = validateDecision(value);
      if (decision.outcome !== undefined) fail('invalid_input', '撤回须通过待办结算发起。');
      const pending = pendingRow.get(ref, decision.opId);
      if (pending && pending.decision !== encode(decision)) fail('ledger_conflict', '待提交操作 ID 已绑定不同决定。');
      const status = snapshot();
      const known = resolveDecision(decision, status);
      if (known) return resolved(known);
      if (pending?.cancel_requested) fail('ledger_pending', '本操作正在撤回，须先结算。');
      const candidate = candidateAt(decision, pending, status.head);
      return { state: 'prepared', candidate };
    },
    async publish(opId, recheck) {
      const pending = pendingRow.get(ref, opId);
      if (!pending) fail('ledger_conflict', '没有已持久化的待提交决定。');
      const decision = validateDecision(JSON.parse(pending.decision));
      const status = snapshot();
      let known = resolveDecision(decision, status);
      if (!known) {
        if (pending.cancel_requested) fail('ledger_pending', '本操作正在撤回，须先结算。');
        await recheck(decision);
        await pushCandidate(decision, pending, status.head, recheck);
        known = resolveDecision(decision, snapshot());
        if (!known) fail('ledger_pending', '远端尚未确认删除决定，使用原操作 ID 查证或重试。');
      }
      return resolved(known);
    },
    discardPrepared(opId) {
      const pending = pendingRow.get(ref, opId);
      if (!pending) return false;
      const status = snapshot();
      if (status.decisions.has(opId)) fail('ledger_conflict', '删除决定已经发布，不能撤回。');
      if (pending.attempted && status.head === pending.parent)
        fail('ledger_pending', '前次推送可能仍在执行，尚不能撤回。');
      clearPending.run(ref, opId);
      return true;
    },
    async cancelPrepared(opId) {
      const pending = pendingRow.get(ref, opId);
      if (!pending) fail('ledger_conflict', '没有已持久化的待提交决定。');
      const decision = validateDecision(JSON.parse(pending.decision));
      const status = snapshot();
      let known = resolveDecision(decision, status);
      if (!known) {
        markCancellation.run(ref, opId);
        await pushCandidate({ ...decision, outcome: 'cancelled' }, pending, status.head);
        known = resolveDecision(decision, snapshot());
        if (!known) fail('ledger_pending', '远端尚未确认撤回，继续核对原操作 ID。');
      }
      // If an earlier push won the race, its deletion must continue instead of compensating.
      return resolved(known);
    },
    complete(opId) {
      const pending = pendingRow.get(ref, opId);
      const status = snapshot();
      if (!pending && status.decisions.has(opId)) return;
      if (!pending || !resolveDecision(JSON.parse(pending.decision), status))
        fail('ledger_pending', '尚未核实远端删除决定。');
      clearPending.run(ref, opId);
    },
    close() { db.close(); },
  };
}
