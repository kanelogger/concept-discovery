import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { documentRevision, matchesNativeSnapshot } from '../lib/documents.mjs';
import { canonical, hash } from '../lib/read-contract.mjs';
import { deletedAttr } from '../lib/siyuan.mjs';
import { openContentLedger } from './content-ledger.mjs';

const nativeId = /^\d{14}-[a-z0-9]{7}$/;
const rawIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const opId = /^[a-zA-Z0-9_-]{1,100}$/;
const digest = /^[0-9a-f]{64}$/;
const commit = /^[0-9a-f]{40}$/;
const unfinished = "state NOT IN ('complete','cancelled')";

function requireProof(ok, message) {
  if (!ok) throw Object.assign(new Error(message), {code:'handoff_mismatch'});
}
const exists = path => lstatSync(path,{throwIfNoEntry:false});
function plainFile(path) {
  requireProof(exists(path)?.isFile() && realpathSync(path)===path,'需要已冻结的普通文件');
  return readFileSync(path);
}
function directory(path) {
  requireProof(isAbsolute(path) && lstatSync(path).isDirectory(), '需要绝对实体目录');
  return realpathSync(path);
}
function within(parent,path) {
  const tail=relative(parent,path);
  return !isAbsolute(tail) && tail!=='..' && !tail.startsWith('..'+sep);
}

// Keep the source SQLite image and its sidecars strictly read-only. Open a private
// duplicate so SQLite can materialize its own SHM index for a frozen WAL.
function copyDatabase(source, scratch, name, sources) {
  const path=join(source,name);
  requireProof(!exists(path+'-journal'),'冻结库有未核实的回滚日志');
  for (const suffix of ['', '-wal']) {
    const file=path+suffix;
    const bytes=suffix && !exists(file) ? null : plainFile(file);
    sources.set(file,bytes && hash(bytes));
    if (bytes) writeFileSync(join(scratch,name+suffix),bytes,{mode:0o600,flag:'wx'});
  }
  sources.set(path+'-journal',null);
  const db=new DatabaseSync(join(scratch,name), {readOnly:true});
  db.exec('PRAGMA query_only=ON');
  return db;
}
function writeJSON(root,name,value) {
  const bytes=Buffer.from(JSON.stringify(value)+'\n');
  writeFileSync(join(root,name),bytes,{mode:0o600,flag:'wx'});
  return hash(bytes);
}

function readArchive({intent, selected, tasks, legacy, operations, libraryId, sources}) {
  const {id:operationId,rawId,documentId,revision}=intent;
  requireProof(selected?.documentId===documentId && intent.library===libraryId && intent.action==='archive' &&
    intent.state==='pending' && !intent.batchId && !intent.cleanupHead && opId.test(operationId) &&
    digest.test(revision) && digest.test(intent.expectedRevision),'导出意图与站主选定的归档身份或状态不符');
  const task=tasks.prepare('SELECT state,plan,progress FROM lifecycle_tasks WHERE id=?').get(operationId);
  requireProof(task?.state==='complete' && !legacy.prepare('SELECT 1 FROM lifecycle_tasks WHERE id=?').get(operationId),
    '归档缺少唯一已完成的数据库维护任务');
  const plan=JSON.parse(task.plan), progress=JSON.parse(task.progress);
  requireProof(plan.library===libraryId && plan.action==='archive' && plan.rawId===rawId && plan.documentId===documentId &&
    plan.revision===intent.expectedRevision && digest.test(plan.signature) && progress.stage==='database-readback' &&
    progress.documentId===documentId && progress.revision===revision,'归档任务与导出意图的写后读回不符');
  // mark-archive can confirm a pre-existing native archive. In that case the
  // operation that set the native tombstone is recorded in the confirmed plan.
  const archiveOp=plan.archiveOp ?? 'db-card-'+operationId;
  requireProof(typeof archiveOp==='string' && opId.test(archiveOp),'归档原生操作标识无效');
  const file=join(operations,archiveOp+'.json'), bytes=plainFile(file);
  sources.set(file,hash(bytes));
  const r=JSON.parse(bytes), before=r.beforeDocument;
  requireProof(r.command==='delete-document' && r.target===libraryId && r.state==='verified' && r.deletionMarker===archiveOp &&
    r.documentId===documentId && r.input?.id===documentId && r.input.op_id===archiveOp &&
    r.requestHash===hash(canonical({command:r.command,input:r.input,target:libraryId})) &&
    r.result?.deleted===true && r.result.id===documentId && r.result.op_id===archiveOp &&
    r.afterRevision===revision && r.result.revision===revision && before?.id===documentId && !before.anchor &&
    before.attrs && !before.attrs[deletedAttr] && !before.attrs['custom-cd-parent'] && before.attrs['custom-cd-kind']!=='article' &&
    before.revision===documentRevision(before) && r.input.expected_revision===before.revision &&
    matchesNativeSnapshot({signature:plan.signature},before),'原生归档回执与知识库、文档、归档标记或修订不符');
  requireProof(plan.archiveOp ? revision===plan.revision :
    before.revision===plan.revision && r.input.expected_signature===plan.signature,'归档前后的操作链不符');
  return {rawId,documentId,archiveOp,revision,signature:plan.signature,operationId};
}

function completedPurges(stores, libraryId) {
  const result=[];
  for (const db of stores) {
    requireProof(!db.prepare('SELECT 1 FROM lifecycle_tasks WHERE '+unfinished+' LIMIT 1').get(),'源库仍有未结算维护任务');
    const rows=db.prepare("SELECT id,state,plan,progress FROM lifecycle_tasks WHERE state='complete' AND json_extract(plan,'$.action')='purge'").all();
    for (const row of rows) {
      const plan=JSON.parse(row.plan), progress=JSON.parse(row.progress);
      requireProof(plan.library===libraryId && nativeId.test(plan.deletion?.native?.id) && progress.stage==='readback' &&
        commit.test(progress.commit),'永久删除任务缺少同库的冻结计划或写后核实记录');
      result.push({id:row.id,state:row.state,plan,progress:{commit:progress.commit}});
    }
  }
  requireProof(new Set(result.map(task=>task.id)).size===result.length &&
    new Set(result.map(task=>task.plan.deletion.native.id)).size===result.length,'永久删除任务或主卡映射重复');
  return result;
}

export function inspectLegacyHandoff(config) {
  const {libraryId, archives:selected, ledgerConfig}=config;
  requireProof(typeof libraryId==='string' && libraryId.trim() && ledgerConfig?.libraryId===libraryId,
    '需要同库的本机验签配置');
  requireProof(Array.isArray(selected) && selected.length===2 && selected.every(row=>typeof row?.rawId==='string' &&
    rawIdPattern.test(row.rawId) && nativeId.test(row.documentId)) &&
    new Set(selected.map(row=>row.rawId)).size===selected.length &&
    new Set(selected.map(row=>row.documentId)).size===selected.length,'需要两条不同的站主选定归档及原公开身份');
  const control=directory(config.controlRoot), operations=directory(config.operationsRoot);
  const output=join(directory(dirname(config.output)),basename(config.output));
  requireProof(!exists(output) && !within(control,output) && !within(operations,output) &&
    !within(control,directory(ledgerConfig.cwd)) && !within(operations,directory(ledgerConfig.cwd)),
    '需使用源库以外的本机 Git 目录及全新输出目录');
  const scratch=mkdtempSync(join(tmpdir(),'cd-legacy-handoff-')), dbs=[], sources=new Map();
  let created=false, success=false;
  try {
    const marker=join(control,'database-first.active'), markerBytes=plainFile(marker);
    requireProof(markerBytes.toString().trim()===libraryId,'旧维护控制根与知识库身份不符');
    sources.set(marker,hash(markerBytes));
    for (const name of ['tasks.sqlite','database-tasks.sqlite','card-exports.sqlite','ledger.sqlite']) {
      dbs.push(copyDatabase(control,scratch,name,sources));
    }
    const [legacy,tasks,queue,journal]=dbs;
    const purgeTasks=completedPurges([legacy,tasks],libraryId);
    requireProof(!queue.prepare("SELECT 1 FROM card_export_batches WHERE state IN ('running','blocked') LIMIT 1").get() &&
      !journal.prepare('SELECT 1 FROM deletion_ledger_pending LIMIT 1').get(),'存在未结算导出批次或待验签决定');
    const intents=queue.prepare('SELECT * FROM card_export_intents WHERE '+unfinished+' ORDER BY sequence').all();
    requireProof(intents.length===selected.length && new Set(intents.map(row=>row.rawId)).size===intents.length,
      '未完成意图与站主选定的归档集合不符');
    const archives=intents.map(intent=>{
      requireProof(!queue.prepare("SELECT 1 FROM card_export_intents WHERE library=? AND rawId=? AND sequence>? AND state<>'cancelled' LIMIT 1")
        .get(libraryId,intent.rawId,intent.sequence),'原归档之后存在新的有效意图');
      return readArchive({intent,selected:selected.find(row=>row.rawId===intent.rawId),tasks,legacy,operations,libraryId,sources});
    });
    const archiveIds=new Set(archives.flatMap(row=>[row.rawId,row.documentId]));
    requireProof(!purgeTasks.some(({plan})=>[plan.rawId,...plan.deletion.native.documents.map(row=>row.id)]
      .some(id=>archiveIds.has(id))),'归档身份与永久删除计划冲突');
    const floor=journal.prepare('SELECT sha FROM deletion_ledger_head WHERE ref=?').get('refs/heads/'+ledgerConfig.branch)?.sha;
    requireProof(commit.test(floor ?? ''),'源控制库缺少已信任的账本检查点');
    const gitReadbackPending=Boolean(journal.prepare('SELECT 1 FROM lifecycle_git_readback LIMIT 1').get());
    const evidenceSha256=writeJSON(scratch,'ledger-evidence.json',{version:1,libraryId,tasks:purgeTasks,publications:[]});
    const settings={...ledgerConfig,evidenceFile:join(scratch,'ledger-evidence.json'),evidenceSha256};
    const signed=openContentLedger(settings).read();
    requireProof(signed.ledgerHead===floor && signed.deletions.deletedIds.length===purgeTasks.length &&
      purgeTasks.every(({plan})=>signed.deletions.deletedIds.includes(plan.deletion.native.id)),
    '权威签名头与冻结控制库或已完成的永久删除集合不符');
    const archiveSha256=writeJSON(scratch,'archive-handoff.json',{version:1,libraryId,archives});
    writeJSON(scratch,'ledger-readback.json',signed);
    const sourceFiles={};
    for (const [file,expected] of sources) {
      const actual=exists(file) ? hash(plainFile(file)) : null;
      requireProof(actual===expected,'源控制库或归档回执在核对期间变化');
      if (actual) sourceFiles[within(control,file) ? 'control/'+basename(file) : 'operations/'+basename(file)]=actual;
    }
    const summary={version:1,libraryId,disposition:'retain-archives-without-git-export',oldExportState:'pending',
      archiveCount:archives.length,archiveSha256,evidenceSha256,ledgerHead:signed.ledgerHead,
      deletionsSha256:signed.deletionsSha256,deletedCount:signed.deletions.deletedIds.length,
      cancelledCount:signed.cancelled.length,gitReadbackPending,sourceFiles};
    writeJSON(scratch,'handoff-summary.json',summary);
    mkdirSync(output,{mode:0o700});
    created=true;
    for (const name of ['ledger-evidence.json','archive-handoff.json','ledger-readback.json','handoff-summary.json']) {
      copyFileSync(join(scratch,name),join(output,name));
    }
    success=true;
    return summary;
  } finally {
    for (const db of dbs) db.close();
    rmSync(scratch,{recursive:true,force:true});
    if (created && !success) rmSync(output,{recursive:true,force:true});
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  try {
    requireProof(process.argv.length===3,'用法：node scripts/inspect-legacy-handoff.mjs 私有配置.json');
    const {sourceFiles,...summary}=inspectLegacyHandoff(JSON.parse(readFileSync(process.argv[2],'utf8')));
    console.log(JSON.stringify(summary));
  } catch (error) {
    console.error(error.code==='handoff_mismatch' ? error.message : '交割核对失败，请核实本机冻结副本、归档回执及权威账本。');
    process.exitCode=1;
  }
}
