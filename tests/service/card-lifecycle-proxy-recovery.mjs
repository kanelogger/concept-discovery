import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { authHTTPSFixture, card, owner } from './auth-https-fixture.mjs';
import { startLifecycleNginx } from './lifecycle-nginx-fixture.mjs';
import { openGitDeletionLedger } from '../../scripts/git-deletion-ledger.mjs';
import { openCardLifecycleGit } from '../../scripts/card-lifecycle-git.mjs';
import { openCardLifecycleTasks } from '../../scripts/card-lifecycle-tasks.mjs';
import { createCardLifecyclePurge } from '../../scripts/card-lifecycle-purge.mjs';
import { createCardLifecycleWorker } from '../../scripts/card-lifecycle-worker.mjs';
import { inspectShareMaterials } from '../../scripts/card-lifecycle-materials.mjs';
import { shareMaterialReader } from '../../server/card-share-preview.mjs';
import { canonical, hash } from '../../lib/siyuan.mjs';

const root = mkdtempSync(join(tmpdir(),'cd-nginx-ledger-'));
const retained = {id:'20261123080010-bbbb123',rawId:'retained',title:'保留合成卡',body:'保留正文。'};
const identity = 'synthetic-library';
const target = 'refs/heads/deletion-drill';
let app, tasks, ledger, ready=false, restoredCopy=true;
const git = (cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
try {
  const repo = join(root,'repo'), remote = join(root,'remote.git');
  git(root,'init','--bare',remote);
  git(root,'init','-b','main',repo);
  git(repo,'config','user.name','Synthetic drill');
  git(repo,'config','user.email','drill@example.invalid');
  mkdirSync(join(repo,'raw/方法/retained'),{recursive:true});
  writeFileSync(join(repo,'raw/方法/retained/article.md'), '---\nname: 保留合成卡\n---\n## 核心理解\n\n保留正文。\n');
  git(repo,'add','raw');
  git(repo,'commit','-m','Synthetic canonical raw');
  const main = git(repo,'rev-parse','HEAD');
  git(repo,'remote','add','drill',remote);
  git(repo,'push','drill','main');
  const empty = execFileSync('git',['mktree'],{cwd:repo,input:'',encoding:'utf8'}).trim();
  const anchor = git(repo,'commit-tree',empty,'-m','Synthetic ledger anchor');
  git(repo,'switch','--detach',anchor);
  mkdirSync(join(repo,'decisions'));
  for (let index=1;index<=11;index++) {
    const opId = 'withdrawn-'+index;
    const filename = 'decisions/'+opId+'.json';
    writeFileSync(join(repo,filename),JSON.stringify({
      version:1,opId,library:identity,rawId:'withdrawn-'+index,previewDigest:'1'.repeat(64),
      mainCommit:main,documents:[card.id],outcome:'cancelled',
    }));
    git(repo,'add',filename);
    git(repo,'commit','-m','Synthetic aborted decision '+index);
  }
  const eleven=git(repo,'rev-parse','HEAD');
  git(repo,'push','drill',eleven+':'+target);
  ledger=openGitDeletionLedger({cwd:repo,remote:'drill',branch:'deletion-drill',anchor,
    journalPath:join(root,'ledger.sqlite'),initialHead:eleven});
  tasks=openCardLifecycleTasks(join(root,'tasks.sqlite'));
  const materialsRoot=join(root,'materials'), stateDir=join(root,'raw-sync');
  mkdirSync(join(materialsRoot,'covers'),{recursive:true});
  const catalogue = {
    target:{id:'target',cardTitle:card.title,title:'旧分享标题',description:'删除卡的专属摘要'},
    retained:{id:'retained',cardTitle:retained.title,title:'保留分享标题',description:'保留卡的专属摘要'},
  };
  writeFileSync(join(materialsRoot,'catalog.json'),JSON.stringify(catalogue));
  copyFileSync(new URL('../../web/share-cover.png',import.meta.url),join(materialsRoot,'covers/target.png'));
  writeFileSync(join(materialsRoot,'covers/retained.png'),Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF/0AAAAASUVORK5CYII=','base64'));
  mkdirSync(join(stateDir,hash(identity)),{recursive:true});
  writeFileSync(join(stateDir,hash(identity),'state.json'),JSON.stringify({identity,version:1,cards:{},readings:{},assets:{}}));
  let lifecycleCalls=0, worker;
  const observe = name => (...args) => { lifecycleCalls++; return worker[name](...args); };
  app=await authHTTPSFixture({through:startLifecycleNginx,requireLifecycleReadiness:true,retained,rawId:'target',
    getShareMaterial:shareMaterialReader(pathToFileURL(materialsRoot+'/')),
    lifecycle:{ready:()=>({ready}),preview:observe('preview'),confirmation:observe('confirmation'),
      confirm:observe('confirm'),archives:observe('archives')}});
  app.beforeRead.current=(method,input)=>{
    if (!restoredCopy && method==='get-document' && input.id===card.id)
      throw Object.assign(new Error('合成卡已清除'),{code:'not_found'});
  };
  const scopedGit = openCardLifecycleGit({cwd:repo,remote:'drill'});
  const rpc = (method,input)=>{
      if (method==='raw-target') return identity;
      if (method==='raw-verify-purge') return !restoredCopy;
      if (method==='raw-remove-purge') {
        assert.equal(input.decision.rawId,'target');
        assert.deepEqual(input.decision.documents,[card.id]);
        restoredCopy=false;
        app.shareFixture.active=false;
        return {};
      }
      assert.fail('Unexpected synthetic kernel call: '+method);
  };
  const purge=createCardLifecyclePurge({git:scopedGit,ledger,stateDir,shares:app.fixtureShareStore(),materialsRoot,rpc});
  worker=createCardLifecycleWorker({git:scopedGit,tasks,stateDir,rpc,purge});
  ready=Boolean(await purge.verifyRecovery(tasks));
  const login=await app.request('/api/session/login',{method:'POST',headers:{Origin:app.url},data:owner});
  assert.equal(login.status,200);
  const headers={Origin:app.url,Cookie:login.headers['set-cookie'][0].split(';')[0]};
  const session = login.json().data.publicId;
  const staleRestore = tasks.preview(session,{action:'restore',library:identity,rawId:'target'}).id;
  const created=await app.request('/api/card-shares/'+card.id,{method:'PUT',headers});
  assert.equal(created.status,200);
  assert.equal(created.json().data.preview.description,catalogue.target.description);
  const old=new URL(created.json().data.url);
  const share={method:'POST',headers,data:{token:old.hash.slice(1)}};
  assert.equal((await app.request('/api/card-share/read',share)).status,200);
  assert.equal((await app.request(old.pathname+'/cover')).status,200);
  const checkRetainedMaterials = async () => {
    const url = '/api/card-shares/'+retained.id;
    const result = await app.request(url,{headers});
    assert.equal(result.json().data.suggestion.description,catalogue.retained.description);
    assert.equal((await app.request(url+'/suggested-cover',{headers})).status,200);
  };
  await checkRetainedMaterials();
  const plan={action:'purge',library:identity,rawId:'target',sourcePath:'方法/target/article.md',evidence:{id:card.id},deletion:{
    native:{id:card.id},copies:{},runtimeMaterials:inspectShareMaterials(materialsRoot,'target').fingerprint,
    bindings:{card:{remoteId:card.id},readings:[],assets:[]},
  }};
  const {id}=tasks.preview('synthetic-owner',plan);
  tasks.confirm('synthetic-owner',id);
  tasks.update(id,'running',{stage:'applying',commit:main});
  ledger.prepare({version:1,opId:id,library:identity,rawId:'target',previewDigest:hash(canonical(plan)),mainCommit:main,documents:[card.id]});
  const done=await ledger.publish(id,()=>{});
  assert.equal(ledger.recoverySnapshot().decisions.size,12);
  ready=false;
  const before=app.calls.length;
  async function assertClosed() {
    const paths=[
      ['/cards/'+card.id,{headers}],['/archives',{headers}],[old.pathname,{}],[old.pathname+'/cover',{}],['/api/card-share/read',share],
      ['/api/v1/commands/get-document',{method:'POST',headers,data:{id:card.id}}],
      ['/api/card-lifecycle/preview',{method:'POST',headers,data:{action:'restore',id:'target'}}],
      ['/api/card-lifecycle/confirm',{method:'POST',headers,data:{id:staleRestore}}],
    ];
    for (const [path,options] of paths) assert.equal((await app.request(path,options)).status,500,path);
    assert.equal(app.calls.length,before);
    assert.equal(lifecycleCalls,0);
  }
  git(remote,'update-ref',target,eleven,done.commit);
  await assert.rejects(purge.reconcileRecovery(tasks),{code:'ledger_changed'});
  await assertClosed();
  git(remote,'update-ref',target,done.commit,eleven);
  await assert.rejects(purge.verifyRecovery(tasks),{code:'ledger_pending'});
  await assertClosed();
  ready=Boolean(await purge.reconcileRecovery(tasks));
  assert.equal(tasks.get(id).state,'complete');
  assert.deepEqual(ledger.pending(),[]);
  assert.equal((await app.request('/api/card-share/read',share)).status,404);
  assert.equal((await app.request(old.pathname+'/cover')).status,404);
  assert.equal((await app.request('/api/card-shares/'+card.id+'/suggested-cover',{headers})).status,404);
  await checkRetainedMaterials();
  const read = id=>app.request('/api/v1/commands/get-document',{method:'POST',headers,data:{id}});
  assert.equal((await read(card.id)).status,404);
  assert.equal((await read(retained.id)).json().data.title,retained.title);
  assert.deepEqual((await app.request('/api/card-lifecycle/archives',{headers})).json().data,[]);
  const preview = await app.request('/api/card-lifecycle/preview',{method:'POST',headers,data:{action:'restore',id:'target'}});
  assert.equal(preview.status,403);
  const confirm = await app.request('/api/card-lifecycle/confirm',{method:'POST',headers,data:{id:staleRestore}});
  assert.equal(confirm.status,400);
  assert.equal(confirm.json().error.code,'invalid_preview');
  assert.equal(tasks.get(staleRestore),null);
  git(repo,'switch','main');
  mkdirSync(join(repo,'raw/方法/target/assets'),{recursive:true});
  writeFileSync(join(repo,'raw/方法/target/assets/orphan.png'),'合成重现的独占附件');
  git(repo,'add','raw');
  git(repo,'commit','-m','Synthetic orphan reappears');
  git(repo,'push','drill','main');
  await assert.rejects(purge.verifyRecovery(tasks),{code:'content_conflict'});
  git(repo,'revert','--no-edit','HEAD');
  git(repo,'push','drill','main');
  ready=Boolean(await purge.verifyRecovery(tasks));
  await app.restart();
  assert.equal((await app.request(old.pathname+'/cover')).status,404);
  assert.equal((await app.request('/api/card-shares/'+card.id+'/suggested-cover',{headers})).status,404);
  await checkRetainedMaterials();
  console.log('PASS Nginx + HTTPS 应用在第 11 版和未清理状态拒绝原卡、旧分享、恢复；核实第 12 版并清理后保留卡可读（合成内核夹具）');
} finally {
  await app?.close();
  tasks?.close();
  ledger?.close();
  rmSync(root,{recursive:true,force:true});
}
