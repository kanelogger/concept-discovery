import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { request as requestHTTPS } from 'node:https';
import { request as requestHTTP } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { benchmarkCardCount, contentFixture, shared } from './content-container-fixture.mjs';

const name = 'cd-content-' + randomUUID().slice(0,8);
const root = realpathSync(mkdtempSync(join(tmpdir(),name+'-')));
const proxy = name + '-proxy', label = 'org.concept-discovery.drill';
const image = name + ':app', composeFile = resolve('deploy/compose.content.yaml');
const evidenceDirectory = resolve('.local/service-acceptance',name);
mkdirSync(evidenceDirectory,{recursive:true,mode:0o700});
const evidence = {name,steps:[],passed:false,cleaned:false};
const samples = {version:1,run:name,unit:'milliseconds',warmupsPerRoute:20,measurementsPerRoute:200,batches:[]};
function persist() { writeFileSync(join(evidenceDirectory,'run.json'),JSON.stringify(evidence,null,2)+'\n',{mode:0o600}); }
function saveSamples() {
  writeFileSync(join(evidenceDirectory,'samples.json'),JSON.stringify(samples)+'\n',{mode:0o600});
  evidence.samplesFile='samples.json';
  persist();
}
function record(step) { evidence.steps.push(step); persist(); console.log(step); }
const env = {...process.env};
let interrupted = false, cleaning = false;
for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{interrupted=true;});
function docker(...args) {
  if (interrupted && !cleaning) throw new Error('演练已中断');
  return execFileSync('docker',args,{encoding:'utf8',timeout:300_000,maxBuffer:8*1024*1024,stdio:'pipe',env}).trim();
}
const compose = (...args)=>docker('compose','-p',name,'-f',composeFile,...args);
// Used only in the separate measurement process. The uninstrumented candidate
// serves both end-to-end measurements and every acceptance/rollback case.
function writeTimingProbe(root,settings) {
  writeFileSync(join(settings,'measure.cjs'),`
    const {subscribe}=require('node:diagnostics_channel');
    const {appendFileSync}=require('node:fs');
    const starts=new WeakMap();
    const routes=new Set(['list','search','graph','scenarios']);
    subscribe('http.server.request.start',({request})=>{
      const route=request.url.split('/').pop();
      if (routes.has(route)) starts.set(request,{route,start:performance.now()});
    });
    subscribe('http.server.response.finish',({request})=>{
      const sample=starts.get(request);
      if (sample) appendFileSync('/tmp/content-timings.ndjson',JSON.stringify([sample.route,performance.now()-sample.start])+'\\n');
    });
  `,{mode:0o600});
  const override=join(root,'measure.json');
  writeFileSync(override,JSON.stringify({services:{app:{environment:{NODE_OPTIONS:'--require=/settings/measure.cjs'}}}}));
  return override;
}
async function freePort() {
  const server = createServer();
  await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
  const port = server.address().port;
  await new Promise(yes=>server.close(yes));
  return port;
}
async function poll(action) {
  let last;
  for (let attempt=0;attempt<60;attempt++) {
    if (interrupted) throw new Error('演练已中断');
    try { return await action(); } catch (error) { last=error; }
    await delay(250);
  }
  throw last;
}
function httpClient(endpoint,origin,ca) {
  const request=ca ? requestHTTPS : requestHTTP;
  return (path,{cookie,body,method,token}={})=>new Promise((yes,no)=>{
    const req=request(new URL(path,endpoint),{ca,method:method??(body?'POST':'GET'),headers:{origin,
      ...(cookie && {cookie}),...(token && {authorization:`Bearer ${token}`}),...(body && {'content-type':'application/json'})}},res=>{
      const chunks=[];
      res.on('error',no);
      res.on('data',chunk=>chunks.push(chunk));
      res.on('end',()=>{const bytes=Buffer.concat(chunks);yes({status:res.statusCode,bytes,headers:res.headers,json:()=>JSON.parse(bytes)});});
    });
    req.setTimeout(3000,()=>req.destroy(new Error('HTTPS 请求超时')));
    req.on('error',no);
    req.end(body && JSON.stringify(body));
  });
}
function nodeMemory(app) {
  assert.equal(docker('exec',app,'readlink','/proc/1/exe'),'/usr/local/bin/node');
  const status=docker('exec',app,'cat','/proc/1/status');
  const rss=Number(/^VmRSS:\s+(\d+) kB$/m.exec(status)[1]);
  const high=Number(/^VmHWM:\s+(\d+) kB$/m.exec(status)[1]);
  return {rssBytes:rss*1024,highWaterMarkBytes:high*1024};
}
async function benchmark(call,cookie,app,transport,retainSamples=true) {
  const routes = {
    list: ['/api/v1/commands/list',{limit:20,includeTags:'page'}],
    search: ['/api/v1/commands/search',{query:'中文检索样本'}],
    graph: ['/api/graph'],scenarios: ['/api/scenarios'],
  };
  const warmups=samples.warmupsPerRoute, iterations=samples.measurementsPerRoute, stats={};
  const batch={transport,routes:[]};
  const start=performance.now();
  for (const [name,[path,body]] of Object.entries(routes)) {
    const times=[];
    let bytes;
    for (let i=0;i<warmups+iterations;i++) {
      if (interrupted) throw new Error('演练已中断');
      const before=performance.now();
      const r=await call(path,{cookie,body});
      const ms=performance.now()-before;
      assert.equal(r.status,200,name);
      const {ok,data}=r.json();
      assert.equal(ok,true,name);
      if (i===0) {
        bytes=r.bytes.length;
        if (name==='list') assert.deepEqual([data.items.length,data.total],[20,benchmarkCardCount+1]);
        if (name==='search') assert.ok(data.length && data.every(row=>row.id.startsWith('bench-')));
        if (name==='graph') assert.deepEqual([data.nodes.length,data.edges.length],[benchmarkCardCount+1,benchmarkCardCount]);
        if (name==='scenarios') assert.equal(data.cards.length,benchmarkCardCount+1);
      }
      times.push(ms);
    }
    const warmupMs=times.slice(0,warmups), measuredMs=times.slice(warmups);
    if (retainSamples) batch.routes.push({name,warmupMs,measuredMs});
    stats[name]={...percentiles(measuredMs),responseBytes:bytes};
  }
  if (retainSamples) { samples.batches.push(batch); saveSamples(); }
  return {activeCards:benchmarkCardCount+1,warmupsPerRoute:warmups,requestsPerRoute:iterations,
    transport, concurrency:1, response:'full body',
    elapsedSeconds:Number(((performance.now()-start)/1000).toFixed(2)),stats,
    nodePid1:nodeMemory(app)};
}
function percentiles(times) {
  const sorted=times.toSorted((a,b)=>a-b);
  const at=p=>Number(sorted[Math.ceil(times.length*p)-1].toFixed(3));
  return {p50Ms:at(0.5),p95Ms:at(0.95)};
}
async function browserRead(origin,cert,credentials) {
  const { chromium, expect }=await import('@playwright/test');
  const { default:config }=await import('../browser/playwright.config.mjs');
  const { headless, viewport, colorScheme }=config.use;
  const spki=new X509Certificate(readFileSync(cert)).publicKey.export({type:'spki',format:'der'});
  const pin=createHash('sha256').update(spki).digest('base64');
  const browser=await chromium.launch({headless,args:['--ignore-certificate-errors-spki-list='+pin]});
  try {
    const page=await browser.newPage({viewport,colorScheme});
    const check=expect.configure({timeout:config.expect.timeout});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/cards');
    await check(page.getByRole('heading',{name:'登录知识库'})).toBeVisible();
    await page.getByLabel('用户名',{exact:true}).fill(credentials.username);
    await page.getByLabel('密码',{exact:true}).fill(credentials.password);
    await page.getByRole('button',{name:'登录',exact:true}).click();
    await check(page).toHaveURL(origin+'/cards');
    const links=page.locator('#card-list .card-title-link');
    await check(links).toHaveCount(20);
    await check(links.first()).toBeVisible();
    await page.locator('#search-input').fill('合成');
    await check(links).toHaveText(['合成 card-c']);
    await links.click();
    await check(page.locator('#document-title')).toHaveText('合成 card-c');
    await page.reload();
    await check(page.locator('#document-body')).toContainText('测试 card-c');
    const image=page.locator('#document-body img').first();
    await check(image).toBeVisible();
    await check(image).toHaveJSProperty('naturalWidth',1);
    assert.deepEqual(errors,[]);
    return {version:browser.version(),viewport,colorScheme,firstPage:20,searchResults:1,card:'card-c',sharedImageWidth:1};
  } finally { await browser.close(); }
}
let composeConfigured=false, proxyId;
try {
  persist();
  const port = await freePort(), proxyPort = await freePort();
  assert.notEqual(port,proxyPort);
  const origin = `https://127.0.0.1:${proxyPort}`;
  const f = await contentFixture(root,origin);
  evidence.build=f.buildMetrics;
  Object.assign(env,{CONCEPT_CONTENT_IMAGE:image,CONCEPT_PORT:String(port),CONCEPT_UID:String(process.getuid()),CONCEPT_GID:String(process.getgid()),
    CONCEPT_CONTENT_RELEASE:f.directory,CONCEPT_CONTENT_SETTINGS:f.settings,CONCEPT_CONTENT_CONTROL:f.controlDirectory,CONCEPT_CONTENT_AUTH:f.auth});
  assert.equal(compose('config','--services'),'app');
  composeConfigured=true;
  docker('build','--file','deploy/Dockerfile','--target','content-runtime','--label',`${label}=${name}`,'--tag',image,'.');
  function boot(override) {
    const extra=override ? ['-f',override] : [];
    compose(...extra,'up','-d','--force-recreate','app');
    if (proxyId) docker('restart',proxyId);
  }
  boot();
  async function direct(path,code) {
    const r=await fetch(`http://127.0.0.1:${port}${path}`,{signal:AbortSignal.timeout(2000)});
    assert.equal(r.status,code,path);
    return r.json();
  }
  await poll(()=>direct('/api/status',200));
  function inspect() {
    const app=compose('ps','-q','app');
    assert.equal(compose('ps','--services','--status','running'),'app');
    const [container]=JSON.parse(docker('inspect',app));
    assert.equal(container.HostConfig.ReadonlyRootfs,true);
    const mountList=container.Mounts.filter(m=>m.Type!=='tmpfs').map(m=>[m.Destination,m.RW]).sort();
    assert.deepEqual(mountList,[['/auth',true],['/content',false],['/control',false],['/settings',false]]);
    assert.deepEqual(container.NetworkSettings.Ports['3000/tcp'],[{HostIp:'127.0.0.1',HostPort:String(port)}]);
    const fingerprint=docker('exec',app,'node','--input-type=module','-e',`
      import {existsSync,readFileSync,readdirSync} from 'node:fs'; import {createHash} from 'node:crypto';
      const excluded=['/app/raw','/app/.git','/app/.local','/app/server/share-materials','/app/scripts/service-start.mjs','/workspace','/app/knowledge.sqlite'];
      if(excluded.some(p=>existsSync(p))) throw new Error('unexpected content in app image');
      const hash=createHash('sha256');
      for (const dir of ['bin','lib','server','scripts','web']) for(const file of readdirSync(dir,{recursive:true}).sort()) {
        if(/\\.(?:js|mjs|html|css)$/.test(file)) hash.update(dir+'/'+file+'\\0').update(readFileSync(dir+'/'+file));
      }
      console.log(hash.digest('hex'));`);
    return {image:container.Image,programSha256:fingerprint};
  }
  evidence.candidate=inspect();
  record('独立 Compose 只有 app，镜像、回环端口、只读根和四个挂载已核对');
  const proxyRoot=join(root,'nginx');
  mkdirSync(proxyRoot,{mode:0o700});
  const key=join(proxyRoot,'key.pem'), cert=join(proxyRoot,'cert.pem');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',key,'-out',cert,
    '-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'pipe'});
  const gate=readFileSync('deploy/nginx-lifecycle-gate.conf','utf8').replace('127.0.0.1:6806','app:3000');
  writeFileSync(join(proxyRoot,'nginx.conf'),`pid /tmp/nginx.pid; error_log /dev/stderr; events {} http { access_log off;
    client_body_temp_path /tmp/client; proxy_temp_path /tmp/upstream; fastcgi_temp_path /tmp/fastcgi; uwsgi_temp_path /tmp/uwsgi; scgi_temp_path /tmp/scgi; server { listen 8443 ssl;
    ssl_certificate /fixture/cert.pem; ssl_certificate_key /fixture/key.pem; ${gate}
    location / { proxy_pass http://app:3000; proxy_set_header Host $http_host; } } }`);
  const nginx=env.CONCEPT_TEST_NGINX_IMAGE??'nginx:stable-alpine';
  proxyId=docker('run','-d','--name',proxy,'--label',`${label}=${name}`,'--network',name+'_default',
    '--read-only','--tmpfs','/tmp','--mount',`type=bind,source=${proxyRoot},target=/fixture,readonly`,
    '-p',`127.0.0.1:${proxyPort}:8443`,'--entrypoint','nginx',nginx,'-c','/fixture/nginx.conf','-g','daemon off;');
  if (docker('inspect','--format','{{.State.Running}}',proxyId)!=='true') throw new Error('合成 Nginx 启动失败：'+docker('logs',proxyId));
  evidence.proxyImage=JSON.parse(docker('inspect',proxyId))[0].Image;
  const call=httpClient(origin,origin,readFileSync(cert));
  const getCard=(id,options)=>call('/api/v1/commands/get-document',{body:{id},...options});
  const readShare=id=>call('/api/card-share/read',{body:f.links[id]});
  const preview=id=>'/share/'+f.links[id].previewId;
  async function closed() {
    await poll(()=>direct('/api/readiness',503));
    for (const path of ['/login','/api/status','/cards/card-c',f.asset,preview('card-b')]) {
      await poll(async()=>assert.equal((await call(path,{cookie:f.cookie})).status,500,path));
    }
    assert.equal((await readShare('card-c')).status,500);
  }
  await closed();
  record('闭门时应用健康仍为 200，readiness 为 503，真实 Nginx 拒绝登录、页面、附件、分享及健康路径');
  f.open(); boot();
  async function ready() { await poll(async()=>assert.equal((await direct('/api/readiness',200)).data.ready,true)); }
  await ready();
  async function verifyCards(cookie) {
    const actual=await getCard('card-c',{cookie});
    assert.equal(actual.status,200); assert.equal(actual.json().data.title,'合成 card-c');
    const asset=await call(f.asset,{cookie});
    assert.equal(asset.status,200); assert.deepEqual(asset.bytes,shared);
    for (const id of ['card-a','card-b']) {
      const r=await getCard(id,{cookie});
      assert.equal(r.status,409,id);
      assert.equal(r.json().error.code,'identity_conflict');
      assert.equal(r.json().data,undefined);
      const bookmark=await call('/cards/'+id,{cookie});
      assert.equal(bookmark.status,200); // The shared reader shell renders missing-card errors client-side.
      assert.doesNotMatch(bookmark.bytes.toString(),/id="initial-page"/);
      assert.equal((await readShare(id)).status,404);
      assert.equal((await call(preview(id)+'/cover')).status,404);
    }
    const search=await call('/api/v1/commands/search',{body:{query:'合成'},token:f.agentToken});
    assert.deepEqual(search.json().data.map(row=>row.id),['card-c']);
  }
  await verifyCards(f.cookie);
  assert.equal((await readShare('card-c')).status,200);
  record('核准后原会话及 C 分享有效，C 详情、真实共享图片、Agent 搜索通过，A/B 详情、旧分享与封面拒绝');
  const app=compose('ps','-q','app');
  const startedAt=()=>docker('inspect','--format','{{.State.StartedAt}}',app);
  async function loginForBenchmark() {
    const login=await call('/api/session/login',{body:f.credentials});
    assert.equal(login.status,200);
    const cookie=login.headers['set-cookie'][0].split(';')[0];
    const session=await call('/api/session',{cookie});
    assert.equal(session.status,200);
    assert.ok(login.json().data.publicId);
    assert.equal(session.json().data.publicId,login.json().data.publicId);
    return cookie;
  }
  evidence.passwordLogin={startedAt:startedAt(),before:nodeMemory(app)};
  const cookie=await loginForBenchmark();
  evidence.passwordLogin.after=nodeMemory(app);
  evidence.performance=await benchmark(call,cookie,app,'loopback HTTPS via Nginx auth_request');
  const directHTTP=httpClient('http://127.0.0.1:'+port,origin);
  evidence.directPerformance=await benchmark(directHTTP,cookie,app,'loopback HTTP directly to published app port');
  assert.equal(startedAt(),evidence.passwordLogin.startedAt);
  record('同一应用进程完成真实密码登录并读回会话；记录登录前后的 RSS 及高水位，TLS 代理和回环直连各对 4 路预热 20 次、实测 200 次并复读 RSS');
  const override=writeTimingProbe(root,f.settings);
  boot(override);
  await poll(()=>direct('/api/status',200));
  const coldStart=performance.now();
  assert.equal((await directHTTP('/api/v1/commands/list',{cookie,body:{limit:20,includeTags:'page'}})).status,200);
  const coldHTTP=performance.now()-coldStart;
  const measuredApp=compose('ps','-q','app');
  await benchmark(directHTTP,await loginForBenchmark(),measuredApp,'timing-probe',false);
  const log=docker('exec',measuredApp,'cat','/tmp/content-timings.ndjson').split('\n').map(line=>JSON.parse(line));
  assert.equal(log.length,881);
  const [cold,...serverSamples]=log;
  assert.equal(cold[0],'list');
  evidence.serverPerformance={interval:'http.server.request.start to http.server.response.finish',
    coldFirstList:{serverMs:Number(cold[1].toFixed(3)),loopbackHTTPMs:Number(coldHTTP.toFixed(3))},stats:{}};
  const serverBatch={transport:evidence.serverPerformance.interval,
    coldFirstList:{serverMs:cold[1],loopbackHTTPMs:coldHTTP},routes:[]};
  for(const route of ['list','search','graph','scenarios']) {
    const group=serverSamples.filter(([name])=>name===route);
    assert.equal(group.length,220);
    const times=group.map(([,ms])=>ms);
    const warmupMs=times.slice(0,samples.warmupsPerRoute), measuredMs=times.slice(samples.warmupsPerRoute);
    serverBatch.routes.push({name:route,warmupMs,measuredMs});
    evidence.serverPerformance.stats[route]=percentiles(measuredMs);
  }
  samples.batches.push(serverBatch); saveSamples();
  record('独立启动同版 Node 并实测冷启首次列表和 4 路服务端鉴权、生成、响应完成时间');
  boot(); await ready();
  evidence.browser=await browserRead(origin,cert,f.credentials);
  record('独立 Chromium 在真实 TLS 代理登录，读到首屏 20 卡、搜索 C、打开并刷新详情和共享图');
  const controlFile=join(f.controlDirectory,'deletions.json');
  renameSync(controlFile,join(root,'saved-deletions.json'));
  writeFileSync(controlFile,'{}');
  await closed();
  renameSync(join(root,'saved-deletions.json'),controlFile);
  await closed();
  record('在线替换删除记录关闭代理，恢复原文件后旧监听仍保持关闭');
  compose('stop','app');
  f.mountCold();
  env.CONCEPT_CONTENT_RELEASE=f.previous;
  f.open(f.previous); boot(); await closed();
  record('包含 A/B 的旧内容与未清理认证冷副本一起挂载，即使配置匹配旧清单摘要仍被当前外部核准拒绝');
  compose('stop','app');
  env.CONCEPT_CONTENT_RELEASE=f.directory;
  f.open(); boot(); await closed();
  record('挂回现行内容包，未完成删除清理的旧认证副本仍被拒绝');
  compose('stop','app');
  f.restore(); f.open(); boot(); await ready();
  async function verifyColdRestore() {
    assert.equal((await call('/api/session',{cookie:f.cookie})).status,401);
    assert.equal((await getCard('card-c',{cookie:f.cookie})).status,401);
    for (const id of ['card-a','card-b','card-c']) {
      assert.equal((await readShare(id)).status,404);
      assert.equal((await call(preview(id))).status,404);
      assert.equal((await call(preview(id)+'/cover')).status,404);
    }
    const login=await call('/api/session/login',{body:f.credentials});
    assert.equal(login.status,200);
    await verifyCards(login.headers['set-cookie'][0].split(';')[0]);
  }
  await verifyColdRestore();
  record('从真实认证冷副本恢复后旧会话、三条旧分享和封面均失效，重新登录仍可读 C 和共享图');
  if (env.CONCEPT_TEST_ROLLBACK_IMAGE) {
    // Only a separately selected local artifact can serve as evidence of a program rollback.
    f.close();
    await closed();
    compose('stop','app');
    env.CONCEPT_CONTENT_IMAGE=env.CONCEPT_TEST_ROLLBACK_IMAGE;
    boot(); await closed();
    evidence.rollback=inspect();
    assert.notEqual(evidence.rollback.programSha256,evidence.candidate.programSha256,'两版程序内容相同');
    f.open(); boot(); await ready();
    await verifyColdRestore();
    renameSync(controlFile,join(root,'withheld-ledger.json'));
    await closed();
    record('切换到不同程序字节的前版镜像，重验 A/B/C、旧会话和分享，撤回外部账本再次验证前版与代理闭门');
  } else evidence.rollback={tested:false,reason:'未提供独立前版镜像'};
  evidence.passed=true;
} finally {
  cleaning=true;
  const failures=[];
  function clean(action) { try {action();} catch(error) {failures.push(error.message);} }
  clean(()=>{const ids=docker('ps','-aq','--filter',`label=${label}=${name}`);if(ids) docker('rm','-f',...ids.split('\n'));});
  if(composeConfigured) clean(()=>{compose('down','--timeout','5');});
  clean(()=>{if(docker('image','ls','-q','--filter',`reference=${image}`)) {
    assert.equal(docker('image','inspect','--format',`{{index .Config.Labels "${label}"}}`,image),name); docker('image','rm',image);
  }});
  clean(()=>{
    assert.equal(docker('ps','-aq','--filter',`label=com.docker.compose.project=${name}`),'');
    assert.equal(docker('network','ls','-q','--filter',`label=com.docker.compose.project=${name}`),'');
    assert.equal(docker('ps','-aq','--filter',`label=${label}=${name}`),'');
    assert.equal(docker('image','ls','-q','--filter',`reference=${image}`),'');
  });
  if (!failures.length) { rmSync(root,{recursive:true,force:true}); evidence.cleaned=!existsSync(root); }
  else evidence.cleanupErrors=failures;
  persist();
  console.log(`演练记录 ${evidenceDirectory}/run.json`);
  if(failures.length) throw new Error(failures.join('\n'));
}
