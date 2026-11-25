import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { openGitDeletionLedger } from '../../scripts/git-deletion-ledger.mjs';
import { githubDeletionLedgerGate, requireGithubLedgerRemote } from '../../scripts/github-deletion-ledger-gate.mjs';
import { verifyDeletionLedgerAppend } from '../../scripts/verify-deletion-ledger-append.mjs';
import { githubInstallationToken } from '../../scripts/github-app-installation.mjs';
import { githubBranchReader } from '../../scripts/github-branch-reader.mjs';

const branch = 'deletion-drill';
const ref = `refs/heads/${branch}`;
const options = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, ...options }).trim();

test('账本读写远端必须与同一个 GitHub 校验仓库绑定',t=>{
  const f=fixture(t);
  git(f.cwd,'remote','add','verified','https://github.com/example/synthetic.git');
  requireGithubLedgerRemote(f.cwd,'verified','example/synthetic',{writing:true});
  git(f.cwd,'remote','set-url','--push','verified','https://github.com/example/other.git');
  requireGithubLedgerRemote(f.cwd,'verified','example/synthetic');
  assert.throws(()=>requireGithubLedgerRemote(f.cwd,'verified','example/synthetic',{writing:true}),{code:'outside_scope'});
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'cd-deletion-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = join(root, 'remote.git');
  git(root, 'init', '--bare', remote);
  const cwd = join(root, 'worker');
  git(root, 'init', cwd);
  git(cwd, 'config', 'user.name', 'Synthetic worker');
  git(cwd, 'config', 'user.email', 'worker@example.invalid');
  git(cwd, 'commit', '--allow-empty', '-m', 'Seed isolated ledger');
  const anchor = git(cwd, 'rev-parse', 'HEAD');
  git(cwd, 'remote', 'add', 'drill', remote);
  git(cwd, 'push', 'drill', `${anchor}:${ref}`);
  const settings = (name = 'journal', initialHead) => ({ cwd, branch, remote: 'drill', anchor,
    initialHead, journalPath: join(root, `${name}.sqlite`) });
  const open = (name, initialHead) => openGitDeletionLedger(settings(name, initialHead));
  const decide = index => ({ version: 1, opId: `operation-${index}`, library: 'synthetic', rawId: `example-${index}`,
    previewDigest: String(index).repeat(64).slice(0, 64), mainCommit: anchor, documents: ['20261124000000-a012345'] });
  return { root, cwd, remote, anchor, open, decide, settings };
}

function signer(f) {
  const signingKey = join(f.root,'synthetic-signing');
  const allowedSignersFile = join(f.root,'allowed-signers');
  execFileSync('ssh-keygen',['-q','-t','ed25519','-N','','-f',signingKey],options);
  writeFileSync(allowedSignersFile,'worker@example.invalid '+readFileSync(signingKey+'.pub','utf8'));
  return {signingKey,allowedSignersFile};
}

test('读回第 12 条不可逆决定后，恢复端拒绝结构完整的第 11 版历史', async t => {
  const f = fixture(t);
  mkdirSync(join(f.cwd,'decisions'));
  for (let index=1;index<=11;index++) {
    const decision = {...f.decide(index),outcome:'cancelled'};
    const file = 'decisions/'+decision.opId+'.json';
    writeFileSync(join(f.cwd,file),JSON.stringify(decision));
    git(f.cwd,'add','--',file);
    git(f.cwd,'commit','-m','合成撤回 '+index);
  }
  const eleven = git(f.cwd,'rev-parse','HEAD');
  git(f.cwd,'push','drill',eleven+':'+ref);
  const initial = f.open('journal',eleven);
  initial.prepare(f.decide(12));
  const published = await initial.publish('operation-12',()=>{});
  initial.complete('operation-12');
  assert.equal(initial.readySnapshot().decisions.size,12);
  initial.close();
  git(f.remote,'update-ref',ref,eleven,published.commit);
  const restored = f.open();
  try {
    assert.throws(()=>restored.readySnapshot(),{code:'ledger_changed'});
    git(f.remote,'update-ref',ref,published.commit,eleven);
    assert.equal(restored.readySnapshot().head,published.commit);
  } finally { restored.close(); }
});

test('签名账本接受指定签署者追加并在读回时拒绝无签名提交', async t => {
  const f = fixture(t);
  const ledger = openGitDeletionLedger({...f.settings('signed',f.anchor),...signer(f)});
  try {
    ledger.prepare(f.decide(1));
    const first = await ledger.publish('operation-1',()=>{});
    ledger.complete('operation-1');
    assert.equal(ledger.readySnapshot().decisions.size,1);
    git(f.cwd,'switch','--detach',first.commit);
    const second = f.decide(2);
    const file = 'decisions/'+second.opId+'.json';
    writeFileSync(join(f.cwd,file),JSON.stringify(second));
    git(f.cwd,'add','--',file);
    git(f.cwd,'commit','--no-gpg-sign','-m','隔离模拟无签名追加');
    git(f.cwd,'push','drill','HEAD:'+ref);
    assert.throws(()=>ledger.readySnapshot(),/verify-commit/);
  } finally { ledger.close(); }
});

test('账本候选先由独立检查核实，其他应用的同名结果不能批准发布',async t=>{
  const f=fixture(t), identity=signer(f), prefix='ledger-candidates/drill';
  let checkerId=7;
  let conclusion='success';
  const gate=githubDeletionLedgerGate({repository:'example/synthetic',prefix,verifier:42,context:'append'},
    {attempts:1,readChecks:async candidate=>{
      const observed=verifyDeletionLedgerAppend({cwd:f.cwd,remote:'drill',branch,prefix,candidate,...identity});
      assert.equal(observed.parent,f.anchor);
      return [{head_sha:candidate,name:'append',app:{id:checkerId},status:'completed',conclusion}];
    }});
  const ledger=openGitDeletionLedger({...f.settings('checked',f.anchor),...identity,beforePush:gate});
  try {
    const {candidate}=ledger.prepare(f.decide(1));
    await assert.rejects(ledger.publish('operation-1',()=>{}),{code:'ledger_pending'});
    assert.equal(git(f.remote,'rev-parse',ref),f.anchor);
    assert.equal(git(f.remote,'rev-parse','refs/heads/'+prefix+'/'+candidate),candidate);
    checkerId=42;
    conclusion='failure';
    await assert.rejects(ledger.publish('operation-1',()=>{}),{code:'ledger_conflict'});
    assert.equal(git(f.remote,'rev-parse',ref),f.anchor);
    conclusion='success';
    const published=await ledger.publish('operation-1',()=>{});
    assert.equal(published.commit,candidate);
    ledger.complete('operation-1');
    assert.equal(ledger.readySnapshot().head,candidate);
    git(f.cwd,'switch','--detach',candidate);
    writeFileSync(join(f.cwd,'unapproved.txt'),'这不是决定文件。');
    git(f.cwd,'add','--','unapproved.txt');
    git(f.cwd,'-c','gpg.format=ssh','-c','user.signingkey='+identity.signingKey,'commit','-S','-m','隔离违规签名提交');
    const wrong=git(f.cwd,'rev-parse','HEAD');
    git(f.cwd,'push','drill',wrong+':refs/heads/'+prefix+'/'+wrong);
    const verifiedContext={cwd:f.cwd,remote:'drill',branch,prefix,candidate:wrong,...identity,requireTrustedParent:true};
    assert.throws(()=>verifyDeletionLedgerAppend({...verifiedContext,allowedSignersFile:join(f.cwd,'missing-signers')}),
      error=>error.status===1 && error.code!=='ledger_changed');
    assert.throws(()=>verifyDeletionLedgerAppend(verifiedContext),
      {code:'ledger_changed'});
  } finally { ledger.close(); }
});

test('发布候选后请求独立校验，写入应用只读取检查并触发指定提交',async ()=>{
  const candidate='1'.repeat(40), repository='example/synthetic', prefix='ledger-candidates/drill';
  const writerInstallation={repository,appId:41};
  const activity=[];
  const gate=githubDeletionLedgerGate({repository,prefix,verifier:42,context:'append',writerInstallation},{
    attempts:2,interval:0,
    async issueWriterToken(settings,role) {
      assert.equal(settings,writerInstallation);
      assert.equal(role,'writer');
      return 'writer-token';
    },
    async readChecks(sha,context,app,token) {
      assert.deepEqual([sha,context,app,token],[candidate,'append',42,'writer-token']);
      if (!activity.includes('dispatch')) return [];
      return [{head_sha:candidate,name:context,app:{id:app},status:'completed',conclusion:'success'}];
    },
    async dispatch(url,options) {
      assert.equal(url,'https://api.github.com/repos/example/synthetic/dispatches');
      assert.equal(options.headers.Authorization,'Bearer writer-token');
      assert.deepEqual(JSON.parse(options.body),{event_type:'concept-ledger-candidate',client_payload:{candidate,prefix}});
      assert.deepEqual(activity,['push']);
      activity.push('dispatch');
      return {ok:true};
    },
  });
  await gate({candidate,remote:'origin',git(args) {
    assert.deepEqual(args,['push','--porcelain','origin',candidate+':refs/heads/'+prefix+'/'+candidate]);
    activity.push('push');
  }});
  assert.deepEqual(activity,['push','dispatch']);
});

test('GitHub 安装令牌只接受一个仓库及当前角色的权限', async t=>{
  const directory=mkdtempSync(join(tmpdir(),'cd-installation-token-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const privateKeyFile=join(directory,'app.pem');
  writeFileSync(privateKeyFile,privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
  const config={repository:'example/synthetic',privateKeyFile,appId:41,installationId:43};
  let role='verifier', permissions={contents:'read',checks:'write'}, granted=permissions;
  const options={now:()=>1_800_000_000_000,
    async fetcher(url, request) {
      assert.equal(url,'https://api.github.com/app/installations/43/access_tokens');
      const [head,payload,signature]=request.headers.Authorization.slice(7).split('.');
      assert.ok(verify('RSA-SHA256',Buffer.from(head+'.'+payload),publicKey,Buffer.from(signature,'base64url')));
      assert.deepEqual(JSON.parse(Buffer.from(payload,'base64url')),{iat:1799999940,exp:1800000540,iss:'41'});
      assert.deepEqual(JSON.parse(request.body),{repositories:['synthetic'],permissions});
      return {ok:true,json:async()=>({token:'scoped-token',repositories:[{full_name:config.repository}],
        permissions:{...granted,metadata:'read'}})};
    },
  };
  assert.equal(await githubInstallationToken(config,role,options),'scoped-token');
  granted={contents:'write',checks:'write'};
  await assert.rejects(githubInstallationToken(config,role,options),/范围未得到核实/);
  role='reader';
  permissions={contents:'read'};
  granted={contents:'read',checks:'read'};
  await assert.rejects(githubInstallationToken(config,role,options),/范围未得到核实/);
  granted=permissions;
  assert.equal(await githubInstallationToken(config,role,options),'scoped-token');
});

test('每次请求已绑定仓库的精确 ref，只短暂复用只读令牌',async ()=>{
  const repository='example/synthetic', writerInstallation={repository};
  const api='https://api.github.com/repos/'+repository+'/git/';
  const urls=new Set();
  let time=0, tokens=0, sha='1'.repeat(40), status=200, redirected=false, change=result=>result;
  const reader=githubBranchReader({repository,writerInstallation},{
    now:()=>time,
    async issueToken(installation,role) {
      assert.equal(role,'reader');
      assert.equal(installation,writerInstallation);
      return 'token-'+(++tokens);
    },
    async fetcher(url,request) {
      assert.equal(request.headers.Authorization,'Bearer token-'+tokens);
      assert.equal(request.method,'GET');
      assert.equal(request.redirect,'error');
      assert.equal(request.cache,'no-store');
      assert.match(request.headers['Cache-Control'],/no-cache/);
      const parsed=new URL(url);
      assert.equal(parsed.origin,'https://api.github.com');
      assert.equal(parsed.pathname,'/repos/'+repository+'/git/ref/heads/ledger/drill');
      assert.ok(parsed.searchParams.get('nonce'));
      assert.equal(urls.has(url),false);
      urls.add(url);
      const result={ref:'refs/heads/ledger/drill',url:api+'refs/heads/ledger/drill',
        object:{type:'commit',sha,url:api+'commits/'+sha}};
      return {status,redirected,json:async()=>change(result)};
    }
  });
  const read=()=>reader('ledger/drill');
  assert.equal(await read(),sha);
  sha='2'.repeat(40);
  assert.equal(await read(),sha);
  assert.equal(tokens,1);
  time+=240001;
  assert.equal(await read(),sha);
  assert.equal(tokens,2);
  for (const modify of [r=>[r],r=>({...r,ref:'refs/heads/ledger/drill-other'}),
    r=>({...r,url:r.url.replace(repository,'other/repo')}),r=>({...r,object:{...r.object,type:'tag'}}),
    r=>({...r,object:{...r.object,sha:'abc'}}),r=>({...r,object:{...r.object,sha:[sha]}}),
    r=>({...r,object:{...r.object,url:r.object.url.replace(repository,'other/repo')}})]) {
    change=modify;
    await assert.rejects(read(),{code:'git_unavailable'});
  }
  change=result=>result;
  redirected=true;
  await assert.rejects(read(),{code:'git_unavailable'});
  redirected=false;
  for (status of [304,404,500,401]) await assert.rejects(read(),{code:'git_unavailable'});
  status=200;
  assert.equal(await read(),sha);
  assert.equal(tokens,3);
  await assert.rejects(reader('../other'),{code:'invalid_input'});
  assert.throws(()=>githubBranchReader({repository,writerInstallation:{repository:'other/repo'}}),{code:'invalid_input'});
});

test('账本精确读取始终核实签名、检查点，并仅按同一远端分支补齐对象',async t=>{
  const f=fixture(t), signing=signer(f), cwd=join(f.root,'reader');
  git(f.root,'clone','--no-local','-b',branch,f.remote,cwd);
  git(cwd,'remote','rename','origin','drill');
  let reported=f.anchor, unavailable=false;
  const ledger=openGitDeletionLedger({...f.settings('reader',f.anchor),cwd,...signing,readBranch:async input=>{
    assert.equal(input,branch);
    if (unavailable) throw new Error('精确引用不可用');
    return reported;
  }});
  const writer=openGitDeletionLedger({...f.settings('writer',f.anchor),...signing});
  t.after(()=>{ledger.close();writer.close();});
  const tracking='refs/concept-deletion/drill/'+branch;
  assert.equal((await ledger.readReadySnapshot()).head,f.anchor);
  writer.prepare(f.decide(1));
  const signed=await writer.publish('operation-1',()=>{});
  assert.throws(()=>git(cwd,'cat-file','-e',signed.commit));
  // A different, newer fetch cannot stand in for the authority observation.
  reported='a'.repeat(40);
  await assert.rejects(ledger.readReadySnapshot(),{code:'git_unavailable'});
  assert.equal(git(cwd,'rev-parse',tracking),f.anchor);
  reported=f.anchor;
  assert.equal((await ledger.readReadySnapshot()).head,f.anchor);
  // A newly created second commit is absent locally and matches the fetch.
  writer.prepare(f.decide(2));
  const second=await writer.publish('operation-2',()=>{});
  reported=second.commit;
  assert.throws(()=>git(cwd,'cat-file','-e',reported));
  assert.equal((await ledger.readReadySnapshot()).decisions.size,2);
  assert.equal(git(cwd,'rev-parse',tracking),reported);
  git(cwd,'remote','set-url','drill',join(f.root,'offline.git'));
  assert.equal((await ledger.readReadySnapshot()).head,reported);
  // Synchronous snapshots and all mutation preflights still require Git.
  assert.throws(()=>ledger.snapshot(),/fetch/);
  assert.throws(()=>ledger.prepare(f.decide(3)),/fetch/);
  unavailable=true;
  await assert.rejects(ledger.readReadySnapshot(),/精确引用不可用/);
  unavailable=false;
  reported=signed.commit;
  await assert.rejects(ledger.readReadySnapshot(),{code:'ledger_changed'});
  assert.equal(git(cwd,'rev-parse',tracking),second.commit);
  git(cwd,'remote','set-url','drill',f.remote);
  git(f.cwd,'switch','--detach',second.commit);
  const file='decisions/operation-3.json';
  writeFileSync(join(f.cwd,file),JSON.stringify(f.decide(3)));
  git(f.cwd,'add',file);
  git(f.cwd,'commit','--no-gpg-sign','-m','unsigned');
  git(f.cwd,'push','drill','HEAD:'+ref);
  reported=git(f.cwd,'rev-parse','HEAD');
  await assert.rejects(ledger.readReadySnapshot(),/verify-commit/);
  assert.equal(git(cwd,'rev-parse',tracking),second.commit);
});

test('只读开闸保留未发送、已尝试以及读取期间新建待办的围栏',async t=>{
  const f=fixture(t);
  let prepareDuringRead=false;
  const ledger=openGitDeletionLedger({...f.settings('pending-api',f.anchor),readBranch:async()=>{
    if (prepareDuringRead) ledger.prepare(f.decide(2));
    return f.anchor;
  }});
  t.after(()=>ledger.close());
  prepareDuringRead=true;
  await assert.rejects(ledger.readReadySnapshot(),{code:'ledger_pending'});
  prepareDuringRead=false;
  assert.equal((await ledger.readReadySnapshot({allowUnsent:true})).head,f.anchor);
  writeFileSync(join(f.remote,'hooks/pre-receive'),'#!/bin/sh\nexit 1\n',{mode:0o700});
  await assert.rejects(ledger.publish('operation-2',()=>{}),{code:'ledger_pending'});
  await assert.rejects(ledger.readReadySnapshot({allowUnsent:true}),{code:'ledger_pending'});
});

test('旧 Git 复核和已开始的空闲核验不能清除新操作的复核凭据',async t=>{
  const f=fixture(t), ledger=f.open('readback',f.anchor);
  t.after(()=>ledger.close());
  const markDuringCheck=()=>{ledger.beginGitReadback();return true;};
  await assert.rejects(ledger.verifyForServing(assert.fail,markDuringCheck),{code:'operation_pending'});
  await assert.rejects(ledger.verifyForServing(markDuringCheck,assert.fail),{code:'operation_pending'});
  assert.equal(ledger.needsGitReadback(),true);
  assert.equal((await ledger.verifyForServing(ledger.readySnapshot,assert.fail)).head,f.anchor);
  assert.equal(ledger.needsGitReadback(),false);
});

for (const advances of [false, true]) {
  test(`推送前重启且远端${advances ? '已有合法追加' : '未变化'}时复用操作 ID`, async t => {
    const f = fixture(t);
    const requested = f.decide(1);
    let ledger = f.open('journal', f.anchor);
    const first = ledger.prepare(requested);
    assert.equal(first.state, 'prepared');
    ledger.close();
    assert.equal(git(f.remote, 'rev-parse', ref), f.anchor);
    if (advances) {
      const other = f.open('other', f.anchor);
      try {
        other.prepare(f.decide(2));
        await other.publish('operation-2', () => {});
        other.complete('operation-2');
      } finally { other.close(); }
    }
    ledger = f.open();
    try {
      assert.equal(ledger.pending()[0].candidate, first.candidate);
      assert.throws(() => ledger.readySnapshot(), { code: 'ledger_pending' });
      const applied = await ledger.publish('operation-1', decision => assert.deepEqual(decision, requested));
      assert.equal(applied.state, 'committed');
      assert.equal(applied.commit === first.candidate, !advances);
      assert.deepEqual(await ledger.publish('operation-1', assert.fail), applied);
      assert.deepEqual([...ledger.snapshot().decisions.keys()], advances ? ['operation-2', 'operation-1'] : ['operation-1']);
      ledger.complete('operation-1');
      assert.deepEqual(ledger.pending(), []);
      assert.equal(ledger.readySnapshot().head, applied.commit);
    } finally { ledger.close(); }
  });
}

test('权威已接受但进程退出时读回原决定，并拒绝完整但过期的账本', async t => {
  const f = fixture(t);
  assert.throws(() => f.open(), { code: 'ENOENT' });
  let ledger = f.open('journal', f.anchor);
  try {
    assert.throws(() => ledger.prepare({ ...f.decide(1), opId: ['operation-1'] }), { code: 'invalid_input' });
    assert.equal(git(f.remote, 'rev-parse', ref), f.anchor);
    ledger.prepare(f.decide(1));
    const first = await ledger.publish('operation-1', () => {});
    ledger.complete('operation-1');
    const prepared = ledger.prepare(f.decide(2));
    // Simulate the transport accepting a push before the worker can observe it.
    git(f.cwd, 'push', 'drill', `${prepared.candidate}:${ref}`);
    ledger.close();
    ledger = f.open();
    const resolved = await ledger.publish('operation-2', assert.fail);
    assert.equal(resolved.commit, prepared.candidate);
    assert.throws(() => ledger.prepare({ ...f.decide(2), rawId: 'another-card' }), /操作 ID/);
    ledger.complete('operation-2');
    git(f.remote, 'update-ref', ref, first.commit);
    assert.throws(() => ledger.snapshot(), { code: 'ledger_changed' });
  } finally { ledger.close(); }
});

test('发送前核对失败可撤回，并清除启动门禁的待办', async t => {
  const f = fixture(t), ledger = f.open('journal', f.anchor);
  try {
    ledger.prepare(f.decide(1));
    assert.throws(()=>ledger.readySnapshot(),{code:'ledger_pending'});
    assert.equal(ledger.readySnapshot({allowUnsent:true}).head,f.anchor);
    await assert.rejects(ledger.publish('operation-1', () => { throw new Error('原批准已过期'); }), /原批准已过期/);
    assert.equal(ledger.discardPrepared('operation-1'), true);
    assert.equal(ledger.readySnapshot().head, f.anchor);
  } finally { ledger.close(); }
});

test('远端在最后核对后回退至祖先时，候选提交不能掩盖回退', async t => {
  const f = fixture(t), ledger = f.open('journal', f.anchor);
  try {
    ledger.prepare(f.decide(1));
    const first = await ledger.publish('operation-1', () => {});
    ledger.complete('operation-1');
    ledger.prepare(f.decide(2));
    await assert.rejects(ledger.publish('operation-2', () => git(f.remote, 'update-ref', ref, f.anchor)), { code: 'ledger_changed' });
    assert.equal(git(f.remote, 'rev-parse', ref), f.anchor);
    git(f.remote, 'update-ref', ref, first.commit);
    assert.throws(()=>ledger.readySnapshot({allowUnsent:true}),{code:'ledger_pending'});
    assert.throws(() => ledger.discardPrepared('operation-2'), { code: 'ledger_pending' });
    assert.equal((await ledger.publish('operation-2', () => {})).state, 'committed');
  } finally { ledger.close(); }
});

test('已持久化发送标记但尚未发送便被终止，换克隆后仍可结算撤回', async t => {
  const f = fixture(t), first = f.open('journal', f.anchor);
  first.prepare(f.decide(1));
  first.close();
  const shim = join(f.root, 'shim');
  mkdirSync(shim);
  const realGit = execFileSync('which', ['git'], options).trim();
  writeFileSync(join(shim, 'git'), '#!/bin/sh\nif [ "$1" = push ]; then kill -KILL "$PPID"; exit 89; fi\nexec "$CD_LEDGER_REAL_GIT" "$@"\n', {mode:0o700});
  const module = new URL('../../scripts/git-deletion-ledger.mjs', import.meta.url).href;
  const child = `import {openGitDeletionLedger} from ${JSON.stringify(module)};
    const ledger=openGitDeletionLedger(${JSON.stringify(f.settings())});
    await ledger.publish('operation-1',()=>{});`;
  assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', child], { ...options,
    env:{ ...process.env, PATH:shim + delimiter + process.env.PATH, CD_LEDGER_REAL_GIT:realGit } }), { signal:'SIGKILL' });
  assert.equal(git(f.remote, 'rev-parse', ref), f.anchor);

  const replacement = join(f.root, 'replacement');
  git(f.root, 'clone', '-b', branch, f.remote, replacement);
  git(replacement, 'remote', 'rename', 'origin', 'drill');
  git(replacement, 'config', 'user.name', 'Replacement worker');
  git(replacement, 'config', 'user.email', 'replacement@example.invalid');
  const ledger = openGitDeletionLedger({ ...f.settings(), cwd:replacement });
  try {
    ledger.prepare(f.decide(1));
    assert.throws(() => ledger.discardPrepared('operation-1'), { code:'ledger_pending' });
    assert.throws(() => ledger.readySnapshot(), { code:'ledger_pending' });
    await assert.rejects(ledger.publish('operation-1', () => { throw new Error('线上复核冲突'); }), /线上复核冲突/);
    const cancelled = await ledger.cancelPrepared('operation-1');
    assert.equal(cancelled.state, 'cancelled');
    assert.equal((await ledger.publish('operation-1', assert.fail)).state, 'cancelled');
    ledger.complete('operation-1');
    assert.equal(ledger.readySnapshot().decisions.get('operation-1').decision.outcome, 'cancelled');
    assert.equal(ledger.readySnapshot().decisions.size, 1);
  } finally { ledger.close(); }
});
