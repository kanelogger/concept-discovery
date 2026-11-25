import { readFileSync, lstatSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMainThread } from 'node:worker_threads';
import { fail } from '../lib/siyuan.mjs';
import { authenticationConfig } from '../server/auth-config.mjs';
import { openAuthStore } from '../server/auth-store.mjs';
import { connectRaw } from './raw-connection.mjs';
import { openCardLifecycleGit } from './card-lifecycle-git.mjs';
import { openCardLifecycleTasks } from './card-lifecycle-tasks.mjs';
import { createCardLifecycleWorker } from './card-lifecycle-worker.mjs';
import { createCardLifecyclePurge } from './card-lifecycle-purge.mjs';
import { openGitDeletionLedger } from './git-deletion-ledger.mjs';
import { requireInstanceFlock } from '../lib/instance-flock.mjs';
import { applyRawSync, selectRawSyncPlan } from './raw-sync.mjs';
import { githubDeletionLedgerGate, requireGithubLedgerRemote } from './github-deletion-ledger-gate.mjs';
import { githubBranchReader } from './github-branch-reader.mjs';
import { openLifecycleGateway } from './card-lifecycle-gateway.mjs';
import { openCardExportQueue } from './card-export-queue.mjs';
import { createDatabaseWorkflow } from './card-database-workflow.mjs';

const taskPollMs = 15000;
const authorityCheckMs = 30000;

function inside(root,path) {
  const part = relative(root,path);
  return !part || (!part.startsWith('..') && !isAbsolute(part));
}

/** Launch from the host supervisor holding the singleton instance lock. */
export async function startCardLifecycle(path, {reconcileRecovered = false, initializeLedger = false, syncCurrentMain = false,
  acceptanceRawIds,transport} = {}) {
  const settingsPath = realpathSync(path), settingsFile = lstatSync(settingsPath);
  if (!settingsFile.isFile() || (settingsFile.mode & 0o077)) throw new Error('维护配置必须是私有文件。');
  const settings = JSON.parse(readFileSync(settingsPath,'utf8'));
  for (const key of ['privateRoot','controlRoot','repository','materialsRoot','socket'])
    if (typeof settings[key] !== 'string' || !isAbsolute(settings[key])) throw new Error('维护路径必须使用绝对路径。');
  const root = realpathSync(settings.privateRoot);
  const control = realpathSync(settings.controlRoot);
  const repository = realpathSync(settings.repository);
  const materialsRoot = realpathSync(settings.materialsRoot);
  const mode=settings.dataFlow ?? 'git-first';
  const databaseFirst=mode==='database-first';
  if (!['git-first','database-first'].includes(mode)) throw new Error('未知的卡片维护模式。');
  if (acceptanceRawIds && (!databaseFirst || !acceptanceRawIds.length))
    fail('outside_scope','手动验收需要已启用的数据库优先流程及指定合成卡。');
  if (inside(root,control) || inside(control,root) || (lstatSync(control).mode & 0o077))
    throw new Error('任务和账本检查点必须位于知识库冷备之外的私有目录。');
  requireInstanceFlock(join(control,'host.lock'));
  const databaseMarker=join(control,'database-first.active');
  if ((!databaseFirst && lstatSync(databaseMarker,{throwIfNoEntry:false})) || (databaseFirst && syncCurrentMain))
    throw new Error('数据库优先实例不能执行 Git 到数据库的覆盖同步。');
  if (inside(repository,materialsRoot) || inside(materialsRoot,repository) || inside(root,materialsRoot))
    throw new Error('运行时分享素材必须与原稿工作副本和知识库冷备分开。');
  if (!settings.ledger?.signingKey || !settings.ledger.allowedSignersFile || settings.ledger.branch === 'main')
    throw new Error('必须配置单独的签名删除账本和信任检查点。');
  if (basename(settings.socket)!=='worker.sock') throw new Error('维护套接字名称应为 worker.sock。');
  if (!settings.ledger.githubChecks) throw new Error('受保护的 Git 账本需要独立 GitHub 候选校验。');
  if (!transport && !initializeLedger && !syncCurrentMain && !acceptanceRawIds)
    return openLifecycleGateway(settings.socket,new URL('./card-lifecycle-background.mjs',import.meta.url),
      {path:settingsPath,reconcileRecovered});
  const checks=settings.ledger.githubChecks;
  requireGithubLedgerRemote(repository,settings.ledger.remote,checks.repository,{writing:true});
  const readBranch=checks.writerInstallation ? githubBranchReader(checks) : undefined;
  if (readBranch) requireGithubLedgerRemote(repository,settings.remote,checks.repository);
  const ledgerConfig = {...settings.ledger,cwd:repository,journalPath:join(control,'ledger.sqlite'),
    readBranch,beforePush:githubDeletionLedgerGate(checks)};
  if (initializeLedger) {
    if (!settings.ledger.initialHead) throw new Error('首次初始化需要已独立核实的 initialHead。');
    const ledger = openGitDeletionLedger(ledgerConfig);
    try { await ledger.readReadySnapshot(); }
    finally { ledger.close(); }
    return null;
  }

  const servicePath = join(root,'service.json');
  const authConfig = authenticationConfig(JSON.parse(readFileSync(servicePath,'utf8')),servicePath);
  if (authConfig.mode !== 'required') throw new Error('启用维护需要 HTTPS 站主认证。');
  const resources = [];
  let queue = Promise.resolve(), closed = false, ready = false, server, timer, tickRunning = false, checkedAt = 0;
  function markReady(value) {
    ready = value;
    transport?.ready(value);
  }
  const exclusive = fn => {
    const running = queue.then(fn);
    queue = running.catch(()=>{});
    return running;
  };
  const close = async () => {
    if (closed) return;
    closed = true;
    markReady(false);
    clearInterval(timer);
    if (server) await new Promise(resolve=>server.close(resolve));
    await queue;
    try { for (const finalize of resources.reverse()) await finalize(); }
    finally { transport?.release(); }
  };
  try {
    const legacyTasks = openCardLifecycleTasks(join(control,'tasks.sqlite'));
    resources.push(()=>legacyTasks.close());
    if (databaseFirst && legacyTasks.hasUnfinished()) fail('operation_pending','先结算尚未完成的 Git 优先任务。');
    const tasks=databaseFirst ? openCardLifecycleTasks(join(control,'database-tasks.sqlite'),{databaseFirst:true}) : legacyTasks;
    const exportQueue=databaseFirst ? openCardExportQueue(join(control,'card-exports.sqlite')) : null;
    if (databaseFirst) resources.push(()=>tasks.close(),()=>exportQueue.close());
    const git = openCardLifecycleGit({cwd:repository,remote:settings.remote,branch:'main',readBranch});
    const ledger = openGitDeletionLedger({...ledgerConfig,initialHead:undefined});
    resources.push(()=>ledger.close());
    const store = openAuthStore(authConfig);
    resources.push(()=>store.close());
    const connection = connectRaw(root,{lifecycleWorker:true,materialsRoot,socketDir:dirname(settings.socket)});
    resources.push(()=>connection.close());
    void connection.ended.then(()=>{
      if (!closed) {
        markReady(false);
        process.exitCode=1;
        void close();
      }
    });
    const {rpc} = connection, stateDir = join(root,'raw-sync');
    const identity = await rpc('raw-target');
    const marker=lstatSync(databaseMarker,{throwIfNoEntry:false});
    if (databaseFirst && marker && (!marker.isFile() || (marker.mode & 0o077) ||
        readFileSync(databaseMarker,'utf8').trim()!==identity))
      fail('outside_scope','数据库优先标识与当前实例不符。');
    const purge = createCardLifecyclePurge({git,ledger,stateDir,rpc,shares:store.shares,materialsRoot,
      removeUnpublishedCopies(plan,decision) {
        if (plan.manualOriginal) exportQueue.forgetManualTitle(decision.opId);
        git.clearUnpublishedCardCopies(plan,decision);
        tasks.clearDatabaseCardPayload(plan.library,plan.rawId);
      }});
    const workflow=databaseFirst ? createDatabaseWorkflow({tasks,legacyTasks,queue:exportQueue,git,stateDir,
      library:identity,rpc,shares:store.shares,purge,origin:JSON.parse(readFileSync(servicePath,'utf8')).publicUrl}) : null;
    const verifyReadback=workflow?.verifyRecovery ?? (()=>purge.verifyRecovery(tasks,{allowUnsent:true}));
    const verifyReadiness=workflow?.verifyReadiness ?? (()=>purge.verifyReadiness(tasks,{allowUnsent:true}));
    const verifyForServing=()=>ledger.verifyForServing(verifyReadback,verifyReadiness);
    if (acceptanceRawIds) {
      if (!marker || tasks.next()) fail('operation_pending','先启用数据库优先流程并结算尚未完成的线上写入。');
      if (!acceptanceRawIds.every(rawId=>exportQueue.createdInDatabase(identity,rawId)))
        fail('outside_scope','验收只能处理本库创建且已读回的合成卡。');
      await workflow.pollManualOriginals({ids:acceptanceRawIds,force:true});
      if (!workflow.acceptanceHasWork(acceptanceRawIds) && exportQueue.outstanding(identity,acceptanceRawIds).length)
        fail('operation_pending','指定合成卡正在等待站主手工删除原稿并推送 main。');
      if (!exportQueue.activeBatch(identity)) await verifyForServing();
      if (workflow.acceptanceHasWork(acceptanceRawIds)) ledger.beginGitReadback();
      const result=await workflow.exportOnce({acceptanceRawIds,poll:false});
      if (result?.state==='blocked') fail(result.errorCode,'手动验收批次仍需核对。');
      await verifyForServing();
      const remaining=exportQueue.outstanding(identity,acceptanceRawIds);
      if (remaining.length) fail(remaining.find(change=>change.errorCode)?.errorCode ??
        exportQueue.summary(identity).issue?.code ?? 'operation_pending','指定合成卡仍有尚未结算的写入。');
      console.log(JSON.stringify({batch:result?.id ?? null,state:result?.state ?? 'already-complete',commit:result?.candidate ?? result?.commit ?? null}));
      await close();
      return null;
    }
    if (syncCurrentMain) {
      if (tasks.hasUnfinished()) throw new Error('先结算已确认的卡片维护任务。');
      await purge.verifyRecovery(tasks);
      const head = git.snapshot();
      ledger.beginGitReadback();
      const result = await git.inspect(head,async rawRoot=>{
        const {plan} = await selectRawSyncPlan({rawRoot,stateDir,rpc});
        if (plan.identity !== identity) throw new Error('同步计划的知识库身份不符。');
        git.assertRawUnchanged(head);
        return applyRawSync({stateDir,rpc,plan});
      });
      await ledger.finishGitReadback(()=>purge.verifyRecovery(tasks));
      console.log(JSON.stringify({commit:head,writes:result.writes}));
      await close();
      return null;
    }
    if (reconcileRecovered) {
      ledger.beginGitReadback();
      store.revokeAll();
      store.shares.revokeAll();
      if (workflow) {
        await workflow.reconcileRecovery();
        await ledger.finishGitReadback(workflow.verifyRecovery);
      } else await ledger.finishGitReadback(()=>purge.reconcileRecovery(tasks));
    }
    if (workflow && !marker) {
      await verifyForServing();
      await git.readSnapshot();
      writeFileSync(databaseMarker,identity+'\n',{flag:'wx',mode:0o600,flush:true});
    }
    if (workflow && !git.observedHead()) {
      if (ledger.needsGitReadback()) git.snapshot();
      else await git.readSnapshot();
    }
    const worker = workflow?.worker ?? createCardLifecycleWorker({git,tasks,stateDir,rpc,purge,manualOriginals:true});
    const guarded = name => (args,deadline) => exclusive(() => {
      if (closed || typeof deadline !== 'bigint' || process.hrtime.bigint()>=deadline)
        throw Object.assign(new Error('维护请求已超过队列等候时间。'),{code:'lifecycle_unavailable'});
      if (name==='confirm' && workflow && ['purge','restore','compensate'].includes(worker.confirmation(...args).action)) {
        if (!workflow.databaseWriteOnly(tasks.confirmationPlan(...args))) ledger.beginGitReadback();
        markReady(false);
      }
      return worker[name](...args);
    });
    server = transport.listen({
      archives:guarded('archives'), preview:guarded('preview'), confirmation:guarded('confirmation'),
      confirm:guarded('confirm'), status:guarded('status'),
      syncStatus:()=>workflow ? worker.syncStatus() : {enabled:false},
      ...(workflow && {draft:guarded('draft'),databasePreview:guarded('databasePreview'),
        resumeSync:(_args,deadline)=>exclusive(()=>{
          if (closed || typeof deadline!=='bigint' || process.hrtime.bigint()>=deadline)
            fail('lifecycle_unavailable','维护请求已超过队列等候时间。');
          return workflow.resumeBatch(_args[1],_args[2]);
        })}),
    });
    const tick = () => {
      if (closed || tickRunning) return;
      tickRunning = true;
      void exclusive(async () => {
        if (closed) return;
        const pending = tasks.next();
        if (pending && !workflow?.databaseWriteOnly(pending.plan)) ledger.beginGitReadback();
        if (['purge','compensate'].includes(pending?.plan.action) || pending?.plan.rawBase) markReady(false);
        if (pending && (await worker.runOnce())?.progress?.error === 'lifecycle_transport_closed')
          throw Object.assign(new Error('内核维护连接已关闭。'),{code:'lifecycle_transport_closed'});
        const resumed=!pending && await workflow?.resumeInterruptedOriginal(()=>{
          ledger.beginGitReadback();
          markReady(false);
        });
        if (!pending && !resumed) await workflow?.pollManualOriginals();
        const exporting=!pending && !resumed && workflow?.hasExport();
        if (exporting) {
          ledger.beginGitReadback();
          if (workflow.maySettlePurge()) markReady(false);
          await workflow.runScheduledExport();
        }
        if (ledger.needsGitReadback() || !ready || performance.now()-checkedAt>=authorityCheckMs) {
          checkedAt=performance.now();
          await rpc('raw-target');
          await verifyForServing();
          markReady(true);
        }
      }).catch(error=>{
        markReady(false);
        console.error('卡片维护等待核对：' + (error.code ?? 'worker_unavailable'));
        if (error.code === 'lifecycle_transport_closed') setImmediate(()=>{
          process.exitCode=1;
          void close();
        });
      }).finally(()=>{tickRunning=false;});
    };
    timer=setInterval(tick,taskPollMs);
    tick();
    return {close};
  } catch (error) {
    await close();
    throw error;
  }
}

if (isMainThread && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode=process.argv[3];
  if (!process.argv[2] || (mode && !['--reconcile-recovered','--initialize-ledger','--sync-current-main','--run-export-batch'].includes(mode)) ||
      (process.argv.length>4 && mode!=='--run-export-batch'))
    throw new Error('需要私有维护配置文件及有效的维护模式。');
  const service = await startCardLifecycle(process.argv[2],{reconcileRecovered:mode === '--reconcile-recovered',
    initializeLedger:mode === '--initialize-ledger',syncCurrentMain:mode === '--sync-current-main',
    ...(mode==='--run-export-batch' && {acceptanceRawIds:process.argv.slice(4)})});
  if (service) for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{void service.close();});
}
