import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { openCardLifecycleGit } from '../../scripts/card-lifecycle-git.mjs';
import { planCardRawChange } from '../../scripts/raw-lifecycle-plan.mjs';
import { openCardExportQueue } from '../../scripts/card-export-queue.mjs';
import { runCardExportBatch } from '../../scripts/card-export-batch.mjs';

const id = n => '12345678-1234-1234-1234-' + String(n).padStart(12, '0');
const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding:'utf8', stdio:['ignore', 'pipe', 'pipe']}).trim();
const article = 'raw/方法/one/article.md';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'cd-card-lifecycle-git-'));
  t.after(() => rmSync(root, { recursive:true, force:true }));
  const holder = join(root, 'holder'), remote = join(root, 'remote.git');
  git(root, 'init', '--bare', remote);
  git(root, 'init', '-b', 'main', holder);
  git(holder, 'config', 'user.name', '合成测试');
  git(holder, 'config', 'user.email', 'synthetic@example.invalid');
  mkdirSync(join(holder, 'raw/方法/one'), {recursive:true});
  writeFileSync(join(holder, article), '---\nname: 合成卡\n---\n\n## 核心理解\n\n只在隔离库中。\n');
  git(holder, 'add', '.');
  git(holder, 'commit', '-m', '合成原稿');
  git(holder, 'remote', 'add', 'origin', remote);
  git(holder, 'push', 'origin', 'main');
  const workerClone = join(root, 'worker');
  git(root, 'clone', '-b', 'main', remote, workerClone);
  git(workerClone, 'config', 'user.name', '合成维护');
  git(workerClone, 'config', 'user.email', 'worker@example.invalid');
  const open = () => openCardLifecycleGit({ cwd:workerClone, remote:'origin' });
  const worker = open(), base = worker.snapshot();
  const archive = tree => new Map([...planCardRawChange({ rawRoot:join(tree,'raw'), rawId:'one', action:'archive',
    archivedAt:'2026-11-24T00:00:00Z' }).edits].map(([path, bytes]) => ['raw/' + path, bytes]));
  return { root, holder, remote, workerClone, worker, open, base, archive, publishChange(path, content) {
    git(holder, 'pull', '--ff-only', 'origin', 'main');
    writeFileSync(join(holder, path), content);
    git(holder, 'add', '.');
    git(holder, 'commit', '-m', '并发修改');
    git(holder, 'push', 'origin', 'main');
    return git(holder, 'rev-parse', 'HEAD');
  } };
}

test('main 精确读取使用本地或同头 Git 对象，拒绝回退、分叉和跟踪头并发变化',async t=>{
  const f=fixture(t);
  let reported=f.base, advanceTracking;
  const reader=openCardLifecycleGit({cwd:f.workerClone,remote:'origin',readBranch:async branch=>{
    assert.equal(branch,'main');
    advanceTracking?.();
    return reported;
  }});
  const tracking='refs/concept-lifecycle-remote/origin/main';
  const offline=join(f.root,'offline.git');
  git(f.workerClone,'remote','set-url','origin',offline);
  assert.equal(await reader.readSnapshot(),f.base);
  assert.throws(()=>reader.status(id(10),f.base),/fetch/);
  git(f.workerClone,'remote','set-url','origin',f.remote);
  const advanced=f.publishChange('one.txt','one');
  reported='f'.repeat(40);
  await assert.rejects(reader.readSnapshot(),{code:'git_unavailable'});
  assert.equal(reader.observedHead(),f.base);
  const latest=f.publishChange('two.txt','two');
  reported=latest;
  assert.throws(()=>git(f.workerClone,'cat-file','-e',latest));
  assert.equal(await reader.readSnapshot(),latest);
  reported=f.base;
  await assert.rejects(reader.readSnapshot(),{code:'content_conflict'});
  const divergent=git(f.workerClone,'commit-tree',f.base+'^{tree}','-p',f.base,'-m','synthetic fork');
  reported=divergent;
  await assert.rejects(reader.readSnapshot(),{code:'content_conflict'});
  assert.equal(reader.observedHead(),latest);
  reported=latest;
  advanceTracking=()=>git(f.workerClone,'update-ref',tracking,advanced,latest);
  await assert.rejects(reader.readSnapshot(),/update-ref/);
  assert.equal(reader.observedHead(),advanced);
});

test('原稿候选可按同一操作 ID 重启读回，补偿保留无关快进提交', t => {
  const f = fixture(t);
  const candidate = f.worker.stage(id(1), f.base, f.archive);
  assert.equal(f.open().status(id(1), f.base).commit, candidate);
  // Server accepts the candidate before this worker records the result.
  git(f.workerClone, 'push', 'origin', candidate + ':refs/heads/main');
  assert.equal(f.open().publish(id(1), f.base).commit, candidate);
  const advanced = f.publishChange('notes.md', '并发说明');
  const revival = f.worker.stageCompensation(id(2), id(1), f.base);
  assert.equal(revival.parent, advanced);
  assert.equal(f.worker.publish(id(2), advanced).state, 'published');
  assert.equal(git(f.remote, 'show', 'main:notes.md'), '并发说明');
  assert.equal(git(f.remote, 'show', 'main:' + article), git(f.remote, 'show', f.base + ':' + article));
});

test('清理专用副本中待删卡的未发布字节，保留 Git 已发布历史和无关候选',t=>{
  const f=fixture(t);
  const other='raw/方法/other/article.md';
  const bytes=Buffer.from('---\nname: 仅存于未发布候选的合成标题\n---\n\n## 核心理解\n\n本候选正文只在本地。\n');
  const draft=f.worker.stage(id(901),f.base,()=>new Map([[article,bytes]]));
  const kept=f.worker.stage(id(902),f.base,()=>new Map([[other,Buffer.from(
    '---\nname: 无关合成卡\n---\n\n## 核心理解\n\n不在清理范围。\n')]]));
  const object=git(f.workerClone,'rev-parse',draft+':'+article);
  const deleted=f.worker.stage(id(903),f.base,()=>new Map([[article,null]]));
  assert.equal(f.worker.publish(id(903),f.base).state,'published');
  f.worker.clearUnpublishedCardCopies({rawId:'one',sourcePath:'方法/one/article.md'},{mainCommit:deleted});
  assert.throws(()=>git(f.workerClone,'cat-file','-t',object));
  assert.match(git(f.workerClone,'show',f.base+':'+article),/只在隔离库/);
  assert.equal(git(f.workerClone,'rev-parse','refs/concept-lifecycle-candidate/'+id(902)),kept);
});

test('四小时批次的 Git 响应丢失后重用候选，仅结算已冻结的数据库修订',async t=>{
  const f=fixture(t);
  let time=Date.parse('2026-11-25T01:00:00+08:00');
  const queue=openCardExportQueue(':memory:',{now:()=>time});
  t.after(()=>queue.close());
  const revision='1'.repeat(64), documentId='20261125010000-synth01', library='test';
  queue.prepare({id:'edit-old',library,rawId:'one',action:'edit',expectedRevision:revision});
  queue.acknowledge('edit-old',{documentId,revision});
  time=Date.parse('2026-11-25T04:00:00+08:00');
  let captures=0;
  const parameters={queue,library,collect(){
    captures++;
    return new Map([[article,Buffer.from('---\nname: 合成首版\n---\n\n## 核心理解\n\n已冻结的第一版。\n')]]);
  },verifyBeforePush:()=>{},settlePurge:()=>assert.fail('文本编辑没有永久删除')};
  const failed=await runCardExportBatch({...parameters,git:{...f.worker,publish(...args) {
    const result=f.worker.publish(...args);
    assert.equal(result.state,'published');
    queue.prepare({id:'edit-new',library,rawId:'one',action:'edit',expectedRevision:revision});
    queue.acknowledge('edit-new',{documentId,revision:'2'.repeat(64)});
    throw Object.assign(new Error('合成丢响应'),{code:'git_unavailable'});
  }}});
  assert.equal(failed.state,'blocked');
  assert.match(git(f.remote,'show','main:'+article),/已冻结的第一版/);
  queue.resume(failed.id);
  const completed=await runCardExportBatch({...parameters,git:f.open()});
  assert.equal(completed.id,failed.id);
  assert.equal(completed.candidate,failed.candidate);
  assert.equal(completed.state,'complete');
  assert.equal(captures,1);
  assert.equal(queue.get('edit-new').state,'pending');
});

test('出站候选推送前仍须核对数据库权限和待删状态',async t=>{
  const f=fixture(t);
  let time=Date.parse('2026-11-25T01:00:00+08:00');
  const queue=openCardExportQueue(':memory:',{now:()=>time});
  t.after(()=>queue.close());
  const library='test', revision='1'.repeat(64);
  queue.prepare({id:'edit-before-purge',library,rawId:'one',action:'edit',expectedRevision:revision});
  queue.acknowledge('edit-before-purge',{documentId:'20261125010000-synth01',revision});
  time=Date.parse('2026-11-25T04:00:00+08:00');
  const superseded=await runCardExportBatch({queue,library,git:f.worker,
    collect:()=>new Map([[article,Buffer.from('---\nname: 不可发布\n---\n\n## 核心理解\n\n旧版本。\n')]]),
    verifyBeforePush(){
      queue.prepare({id:'purge-after-freeze',library,rawId:'one',action:'purge',expectedRevision:revision});
      throw Object.assign(new Error('存在更新的待删意图'),{code:'newer_purge_pending'});
    },
    settlePurge:()=>assert.fail('未发布原稿时不能清理线上副本'),
  });
  assert.equal(superseded.state,'superseded');
  assert.equal(git(f.remote,'rev-parse','main'),f.base);
  assert.equal(queue.pendingPurge(library,'one').id,'purge-after-freeze');
  queue.acknowledge('purge-after-freeze',{documentId:'20261125010000-synth01',revision:'2'.repeat(64)});
  time+=14400000;
  assert.deepEqual(queue.claimDue(library,f.base).changes.map(item=>item.action),['edit','purge']);
});

test('四小时批次在首次读取 Git 失败时也持久显示异常',async t=>{
  let time=Date.parse('2026-11-25T01:00:00+08:00');
  const queue=openCardExportQueue(':memory:',{now:()=>time});
  t.after(()=>queue.close());
  const library='test', revision='1'.repeat(64);
  queue.prepare({id:'edit-next',library,rawId:'one',action:'edit',expectedRevision:revision});
  queue.acknowledge('edit-next',{documentId:'20261125010000-synth01',revision});
  time=Date.parse('2026-11-25T04:00:00+08:00');
  const result=await runCardExportBatch({queue,library,git:{snapshot(){throw new Error('合成断网');}}});
  assert.equal(result,null);
  assert.deepEqual(queue.summary(library).issue,{code:'git_unavailable'});
  assert.equal(queue.get('edit-next').state,'pending');
});

test('Git 已固定候选但还未写入批次时中断，可以在远端前进后继续下一批次',async t=>{
  const f=fixture(t);
  let time=Date.parse('2026-11-25T01:00:00+08:00');
  const queue=openCardExportQueue(':memory:',{now:()=>time});
  t.after(()=>queue.close());
  const library='test',revision='1'.repeat(64);
  queue.prepare({id:'old-candidate',library,rawId:'one',action:'edit',expectedRevision:revision});
  queue.acknowledge('old-candidate',{documentId:'20261125010000-synth01',revision});
  time=Date.parse('2026-11-25T04:00:00+08:00');
  const original=queue.claimDue(library,f.base);
  const pinned=f.worker.stage(original.id,f.base,f.archive);
  assert.equal(queue.activeBatch(library).candidate,null);
  const moved=f.publishChange('notes.md','无关文件的新内容');
  const resumed=await runCardExportBatch({queue,library,git:f.open()});
  assert.equal(resumed.state,'superseded');
  assert.equal(resumed.candidate,pinned);
  assert.equal(git(f.remote,'rev-parse','main'),moved);
  assert.equal(queue.get('old-candidate').state,'pending');
  time+=14400000;
  const next=queue.claimDue(library,moved);
  assert.notEqual(next.id,original.id);
  assert.deepEqual(next.changes.map(item=>item.id),['old-candidate']);
});

test('文件冲突不能补偿覆盖，未推送候选不会覆盖并发快进', t => {
  const f = fixture(t);
  f.worker.stage(id(3), f.base, f.archive);
  const first = f.publishChange('notes.md', '先快进');
  assert.equal(f.worker.publish(id(3), f.base).state, 'conflict');
  f.worker.stage(id(4), first, f.archive);
  assert.equal(f.worker.publish(id(4), first).state, 'published');
  const manual = git(f.remote, 'show', 'main:' + article) + '\n并发编辑。\n';
  f.publishChange(article, manual);
  assert.equal(f.worker.status(id(4), first).state, 'published-conflict');
  assert.throws(() => f.worker.stageCompensation(id(5), id(4), first), {code:'content_conflict'});
  assert.match(git(f.remote, 'show', 'main:' + article), /并发编辑/);
});

test('远端明确拒绝推送后仍核对分支，避免任务无限尝试已拒绝的提交', t => {
  const f = fixture(t);
  f.worker.stage(id(6), f.base, f.archive);
  writeFileSync(join(f.remote, 'hooks/pre-receive'), '#!/bin/sh\nexit 1\n', {mode:0o700});
  assert.equal(f.worker.publish(id(6), f.base).state, 'refused');
  assert.equal(git(f.remote, 'rev-parse', 'main'), f.base);
});

test('Git 已接受原稿但调用方收到失败时，仍从远端读回候选', t => {
  const f = fixture(t);
  const sha = f.worker.stage(id(7), f.base, f.archive);
  const shim = join(f.root,'shim'), originalPath = process.env.PATH;
  mkdirSync(shim);
  const realGit = execFileSync('which',['git'],{encoding:'utf8'}).trim();
  writeFileSync(join(shim,'git'),
    '#!/bin/sh\ncase " $* " in *" push --porcelain "*) "$CD_GIT" "$@" || exit $?; exit 73;; esac\nexec "$CD_GIT" "$@"\n',
    {mode:0o700});
  process.env.PATH = shim + delimiter + originalPath;
  process.env.CD_GIT = realGit;
  try {
    const result = f.worker.publish(id(7), f.base);
    assert.equal(result.state, 'published');
    assert.equal(result.commit, sha);
  } finally {
    process.env.PATH = originalPath;
    delete process.env.CD_GIT;
  }
  assert.equal(git(f.remote,'rev-parse','main'), sha);
});
