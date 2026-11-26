import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { canonical, hash } from '../../lib/read-contract.mjs';
import { captureContentPublication, openContentLedger, verifyContentCandidate } from '../../scripts/content-ledger.mjs';
import { validateDecision } from '../../scripts/git-deletion-ledger.mjs';
import { verifyDeletionLedgerAppend } from '../../scripts/verify-deletion-ledger-append.mjs';
import { fixture, old, reading } from './content-command-fixture.mjs';
import { createContentLedgerDrill } from './content-ledger-fixture.mjs';

function drill(t) {
  const f=fixture(t), publishedRelease=dirname(f.build());
  const result=createContentLedgerDrill(join(f.root,'ledger'),{
    libraryId:'fixture',publicId:'new',rawRoot:f.raw,publishedRelease,
  });
  const {git,config}=result;
  function append(value,{parent=result.candidate,sign=true,file='decisions/'+value.opId+'.json',executable=false,key}={}) {
    git(config.cwd,'checkout','--detach',parent);
    mkdirSync(join(config.cwd,'decisions'),{recursive:true});
    writeFileSync(join(config.cwd,file),JSON.stringify(value));
    if (executable) chmodSync(join(config.cwd,file),0o755);
    git(config.cwd,'add','--',file);
    git(config.cwd,...(key?['-c','user.signingkey='+key]:[]),'commit',sign?'-S':'--no-gpg-sign','-m','Drill append');
    return git(config.cwd,'rev-parse','HEAD');
  }
  return {...f,publishedRelease,...result,append};
}

test('核准从已签权威历史导出稳定主卡 ID，旧清理器拒绝纯 slug 决定',t=>{
  const f=drill(t);
  const initial=f.read();
  assert.equal(initial.ledgerHead,f.candidate);
  assert.deepEqual(initial.deletions,{version:1,libraryId:'fixture',deletedIds:['new']});
  assert.equal(initial.deletionsSha256,hash(initial.deletions));
  assert.throws(()=>validateDecision(f.decision),{code:'invalid_input'});
  // A completed native purge can list the reading before its parent.
  const plan={library:'fixture',action:'purge',rawId:'old-name',evidence:{id:old},
    deletion:{native:{id:old,documents:[{id:reading},{id:old}]}}};
  const legacy={version:1,opId:'native-delete',library:'fixture',rawId:'old-name',mainCommit:f.decision.sourceCommit,
    previewDigest:hash(canonical(plan)),documents:[reading,old]};
  const commit=f.append(legacy);
  assert.throws(()=>f.push(commit,f.candidate),/push/);
  assert.throws(()=>f.approve(commit),/冻结/);
  assert.throws(()=>f.push(commit,f.candidate),/push/);
  const evidence={...f.evidence,tasks:[{id:legacy.opId,plan,state:'complete',progress:{commit:legacy.mainCommit}}]};
  writeFileSync(f.config.evidenceFile,JSON.stringify(evidence));
  assert.throws(()=>f.read(),/摘要/);
  f.config.evidenceSha256=hash(evidence);
  writeFileSync(f.configFile,JSON.stringify(f.config));
  const verifier={...JSON.parse(readFileSync(f.verifierFile)),evidenceSha256:f.config.evidenceSha256};
  writeFileSync(f.verifierFile,JSON.stringify(verifier));
  f.approve(commit);
  f.push(commit,f.candidate);
  assert.deepEqual(f.read().deletions.deletedIds,[old,'new']);
  const cancellation=f.append({...legacy,opId:'cancelled-native',outcome:'cancelled'},{parent:commit});
  f.approve(cancellation);
  f.push(cancellation,commit);
  assert.deepEqual(f.read(),{ledgerHead:cancellation,deletions:{version:1,libraryId:'fixture',deletedIds:[old,'new']},
    deletionsSha256:hash({version:1,libraryId:'fixture',deletedIds:[old,'new']}),cancelled:['cancelled-native']});
  // Even a valid signed predecessor on the exact authoritative branch is stale.
  f.git(f.config.authority.localBare,'update-ref','refs/heads/'+f.config.branch,commit,cancellation);
  assert.throws(()=>f.read());
});

test('独立 verifier 拒绝未签或不受信签名、错误父提交、非法追加和未知格式',t=>{
  const f=drill(t);
  const other=join(f.root,'other');
  execFileSync('ssh-keygen',['-q','-t','ed25519','-N','','-f',other]);
  let id=0;
  for (const options of [{sign:false},{key:other},{parent:f.config.anchor},{executable:true},{file:'other.json'},
    {delta:{version:3}},{delta:{documents:[old]}},{delta:{sourceCommit:'HEAD'}}]) {
    const {delta,...args}=options;
    const candidate=f.append({...f.decision,opId:'rejection-'+(++id),...delta},args);
    assert.throws(()=>f.approve(candidate));
    assert.throws(()=>f.push(candidate,f.candidate));
    assert.equal(f.read().ledgerHead,f.candidate);
  }
});

test('两项本机独立校验可共用一个 verifier 工作副本，分别读回精确父子提交',async t=>{
  const f=drill(t);
  const {prepare}=openContentLedger(f.config);
  const candidates=['one','two'].map(opId=>prepare({...f.decision,opId,outcome:'cancelled'}).candidate);
  for (const id of candidates) f.git(f.config.cwd,'push','drill',id+':refs/heads/ledger-candidates/drill/'+id);
  const cli=fileURLToPath(new URL('../../scripts/content-ledger.mjs',import.meta.url));
  const results=await Promise.all(candidates.map(id=>promisify(execFile)(process.execPath,
    [cli,'verify-candidate',f.verifierFile,id],{encoding:'utf8',timeout:30_000})));
  assert.deepEqual(results.map(result=>JSON.parse(result.stdout).candidate),candidates);
  assert.deepEqual(results.map(result=>JSON.parse(result.stdout).parent),[f.candidate,f.candidate]);
  assert.equal(f.git(JSON.parse(readFileSync(f.verifierFile)).cwd,'for-each-ref','refs/concept-check'),'');
});

test('签署前核对同库首次公开主卡及原稿提交，拒绝变更原稿及重复或冒名决定',t=>{
  const f=drill(t);
  const ledger=openContentLedger(f.config);
  for (const change of [{publicId:'old'},{publicId:reading},{sourceCommit:f.config.anchor},{library:'other'},
    {publicationSha256:'0'.repeat(64)},{publicId:'new'}]) {
    assert.throws(()=>ledger.prepare({...f.decision,opId:'other',...change}));
  }
  const capture={cwd:f.config.cwd,sourceCommit:f.decision.sourceCommit,libraryId:'fixture',rawRoot:f.raw,
    publishedRelease:f.publishedRelease,manifestSha256:hash(readFileSync(join(f.publishedRelease,'manifest.json')))};
  writeFileSync(join(f.raw,'学科/new/article.md'),'---\nname: 变更\n---\n\n## 核心理解\n\n已变化。');
  assert.throws(()=>captureContentPublication(capture),/提交不符/);
  assert.throws(()=>openContentLedger({...f.config,authority:{localBare:f.config.cwd}}).read(),/本地演练库/);
});

test('站主 stage、本机 verifier App 回传检查、writer 核实推进，全程无远端工作流',async t=>{
  const f=drill(t), repository='example/synthetic', prefix='ledger-candidates/drill';
  const common={repository,prefix,verifier:42,context:'append-only'};
  const writer={...f.config,githubGate:{...common,writerInstallation:{repository,appId:41}}};
  const checker={...JSON.parse(readFileSync(f.verifierFile)),githubGate:{...common,writer:41,verifierInstallation:{repository,appId:42}}};
  let runs=[], observed=[], nextId=10;
  const transport={
    async issueToken(install,role) {
      assert.equal(install.appId,{writer:41,verifier:42}[role]);
      return role+'-token';
    },
    async fetcher(url,request) {
      const target=new URL(url);
      observed.push(request.method+' '+target.pathname);
      assert.equal(target.origin,'https://api.github.com');
      if (request.method==='POST') {
        assert.equal(target.pathname,'/repos/example/synthetic/check-runs');
        assert.equal(request.headers.Authorization,'Bearer verifier-token');
        const run={...JSON.parse(request.body),app:{id:42},id:nextId++};
        runs=[run];
        if (run.conclusion==='success') {
          const parent=f.git(f.config.cwd,'show','-s','--format=%P',run.head_sha);
          writeFileSync(join(f.config.authority.localBare,'verified',parent+'-'+run.head_sha),'app-42');
        }
        return {ok:true,json:async()=>run};
      }
      assert.equal(request.method,'GET');
      assert.match(target.pathname,/^\/repos\/example\/synthetic\/commits\/[a-f0-9]{40}\/check-runs$/);
      assert.equal(request.headers.Authorization,'Bearer writer-token');
      assert.equal(target.searchParams.get('app_id'),'42');
      return {ok:true,json:async()=>({check_runs:runs,total_count:runs.length})};
    },
  };
  const ledger=openContentLedger(writer,transport);
  const {candidate}=ledger.prepare({...f.decision,opId:'cancelled-two',outcome:'cancelled'});
  await assert.rejects(ledger.publish(candidate),/精确校验引用/);
  ledger.stage(candidate);
  assert.equal(observed.length,0);
  assert.throws(()=>verifyDeletionLedgerAppend({...checker,prefix,candidate,requireTrustedParent:true}),{code:'ledger_changed'});
  await assert.rejects(ledger.publish(candidate),/成功检查/);
  const valid={name:common.context,head_sha:candidate,app:{id:42},status:'completed',conclusion:'success',id:1};
  for (const change of [{head_sha:f.candidate},{app:{id:41}},{conclusion:'failure'},{status:'in_progress'}]) {
    runs=[{...valid,...change}];
    await assert.rejects(ledger.publish(candidate),/成功检查/);
  }
  runs=[valid,{...valid,id:2,conclusion:'failure'}];
  await assert.rejects(ledger.publish(candidate),/最新成功检查/);
  assert.equal(f.read().ledgerHead,f.candidate);
  assert.equal((await verifyContentCandidate(checker,candidate,transport)).candidate,candidate);
  runs.push({...runs[0],id:runs[0].id-1,conclusion:'failure'});
  const accepted=await ledger.publish(candidate);
  assert.deepEqual(accepted,await ledger.publish(candidate));
  assert.equal(accepted.ledgerHead,candidate);
  assert.deepEqual(accepted.cancelled,['cancelled-two']);
  const invalid=f.append({...f.decision,opId:'unsigned'},{parent:candidate,sign:false});
  f.git(f.config.cwd,'push','drill',invalid+':refs/heads/'+prefix+'/'+invalid);
  await assert.rejects(verifyContentCandidate(checker,invalid,transport),/拒绝/);
  assert.equal(runs[0].conclusion,'failure');
  const unmapped=f.append({...f.decision,opId:'mismatched-proof',publicId:'unpublished'},{parent:candidate});
  f.git(f.config.cwd,'push','drill',unmapped+':refs/heads/'+prefix+'/'+unmapped);
  await assert.rejects(verifyContentCandidate(checker,unmapped,transport),/拒绝/);
  assert.equal(runs[0].conclusion,'failure');
  assert.throws(()=>f.push(unmapped,candidate),/push/);
  assert.equal(f.read().ledgerHead,candidate);
  assert.equal(observed.filter(line=>line.includes('/dispatches')).length,0);
});
