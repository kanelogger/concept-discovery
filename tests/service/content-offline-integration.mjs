import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { collectOfflineEvidence } from './content-offline-evidence.mjs';
import { packageContentDelivery } from '../../scripts/package-content-delivery.mjs';
import { createContentLedgerDrill } from '../tooling/content-ledger-fixture.mjs';
import { contentFixture, sha, shared } from './content-container-fixture.mjs';

const {values}=parseArgs({options:{machine:{type:'string'},image:{type:'string'},'previous-image':{type:'string'},
  'previous-version':{type:'string'},'program-version':{type:'string'},platform:{type:'string'},'github-ip':{type:'string'},help:{type:'boolean'}}});
if (values.help) {
  console.log('node tests/service/content-offline-integration.mjs --machine cd-routea-… --platform linux/amd64 --image NEW --program-version REV --previous-image PREVIOUS --previous-version REV [--github-ip VERIFIED_IPV4]');
  process.exit(0);
}
for (const key of ['machine','image','previous-image','program-version','previous-version','platform']) assert.ok(values[key],key);
assert.match(values.machine,/^cd-routea-[a-z0-9]+$/);
assert.notEqual(values.image,values['previous-image']);
assert.notEqual(values['program-version'],values['previous-version']);
const name='run-'+randomBytes(6).toString('hex');
const work=mkdtempSync(join(tmpdir(),'cd-offline-owner-'));
const evidence=resolve('.local','service-acceptance','cd-offline-'+name.slice(4));
mkdirSync(evidence,{recursive:true,mode:0o700});
const base='/var/lib/concept-offline-drill', guestRoot=base+'/'+name, observer=base+'/observe.sh';
const guestArgs=['run','-m',values.machine,'-u','root','-w','/'];
const result={name,machine:values.machine,platform:values.platform,steps:{},passed:false};
const persist=()=>writeFileSync(join(evidence,'run.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
const opts={stdio:['ignore','pipe','inherit'],encoding:'utf8',timeout:480000,maxBuffer:16*1024*1024};
const guest=(...args)=>execFileSync('orbctl',[...guestArgs,...args],opts).trim();
async function transfer(local,entries,destination) {
  guest('mkdir','-p',destination);
  const src=spawn('tar',[...(process.platform==='darwin'?['--no-xattrs','--no-mac-metadata']:[]),'-cf','-','-C',local,...entries],{env:{...process.env,COPYFILE_DISABLE:'1'},stdio:['ignore','pipe','inherit']});
  const sink=spawn('orbctl',[...guestArgs,'tar','--no-same-owner','-xf','-','-C',destination],{stdio:['pipe','ignore','inherit']});
  const done=proc=>new Promise((yes,no)=>{proc.once('error',no);proc.once('close',code=>code===0?yes():no(new Error('Artifact transfer failed: '+code)));});
  try { await Promise.all([done(src),done(sink),pipeline(src.stdout,sink.stdin)]); }
  catch(error){src.kill();sink.kill();throw error;}
}
async function fileDigest(file) {
  const hash=createHash('sha256');
  for await(const part of createReadStream(file)) hash.update(part);
  return hash.digest('hex');
}
function checked(label,step,observed=true) {
  const args=['python3',guestRoot+'/checks.py',name,step];
  const raw=observed?guest(observer,'run',label,...args):guest(...args);
  const data=JSON.parse(raw.split('\n').at(-1));
  result.steps[label]=data;persist();
  console.log(label+' passed');
  return data;
}
const observe=(...args)=>guest(observer,...args);
let tracing=false, guestOwned=false, observerRequested=false, failureKind='functional';
try {
  assert.equal(guest('hostname'),values.machine);
  assert.equal(guest('cat',base+'/.dedicated-host'),values.machine);
  assert.equal(guest('docker','--host','unix:///run/docker.sock','info','-f','{{.Name}}'),values.machine);
  assert.equal(guest('docker','ps','-aq'),'','Use a fresh dedicated guest');
  assert.equal(guest('docker','image','ls','-aq'),'','Use a fresh guest image store');
  const fixtureRoot=join(work,'fixture'); mkdirSync(fixtureRoot);
  let ledger;
  const fixture=await contentFixture(fixtureRoot,'https://127.0.0.1:18443',{releaseLabel:name,createLedger:args=>{
    ledger=createContentLedgerDrill(join(work,'owner-ledger'),args);
    return ledger;
  }});
  const close=fixture.close();
  const controlSha=sha(readFileSync(join(fixture.controlDirectory,'deletions.json')));
  const authority=ledger.read();
  assert.equal(close.deletionsSha256,authority.deletionsSha256);
  const identity=JSON.parse(readFileSync(join(fixture.controlDirectory,'approved.json'))).authIdentity;
  const tls=join(work,'tls');mkdirSync(tls);
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',join(tls,'key.pem'),'-out',join(tls,'cert.pem'),
    '-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
  const nginx=join(work,'nginx.conf'),readiness=join(work,'readiness.conf');
  writeFileSync(readiness,readFileSync('deploy/nginx-lifecycle-gate.conf','utf8').replace('127.0.0.1:6806','127.0.0.1:16806'));
  writeFileSync(nginx,[
    'server { listen 127.0.0.1:18443 ssl; server_name 127.0.0.1; access_log off;',
    'ssl_certificate '+guestRoot+'/tls/cert.pem; ssl_certificate_key '+guestRoot+'/tls/key.pem;',
    'include '+guestRoot+'/nginx-readiness.conf;',
    'location / { proxy_pass http://127.0.0.1:16806; proxy_set_header Host $http_host; } }',
  ].join('\n'));
  const pack=(image,programVersion,directory,output)=>packageContentDelivery({image,platform:values.platform,
    'program-version':programVersion,'input-version':JSON.parse(readFileSync(join(directory,'manifest.json'))).inputs.raw,
    'library-id':'container-drill',release:directory,compose:'deploy/compose.content.yaml',nginx,readiness,output});
  const previousDir=join(work,'previous'),newDir=join(work,'incoming');
  const previous=await pack(values['previous-image'],values['previous-version'],fixture.previous,previousDir);
  const candidate=await pack(values.image,values['program-version'],fixture.directory,newDir);
  assert.notEqual(previous.configSha256,candidate.configSha256);
  const beforeTar=join(previousDir,'image.tar');
  result.previous={imageRef:previous.imageRef,configSha256:previous.configSha256,programVersion:values['previous-version']};
  result.delivery={manifestSha256:candidate.manifestSha256,imageRef:candidate.imageRef,configSha256:candidate.configSha256,programVersion:values['program-version']};
  result.ledgerHead=authority.ledgerHead;
  console.log('Owner verified signed deletion ledger and sealed both program archives');
  persist();
  const setup=join(work,'bootstrap');mkdirSync(setup);
  cpSync('deploy/install-content-delivery.py',join(setup,'install.py'));
  cpSync('tests/service/content-offline-host.py',join(setup,'checks.py'));
  cpSync(tls,join(setup,'tls'),{recursive:true});
  const live=join(setup,'live');mkdirSync(live);
  for (const key of ['auth','settings']) cpSync(fixture[key],join(live,key),{recursive:true});
  cpSync(fixture.controlDirectory,join(live,'control'),{recursive:true});
  writeFileSync(join(setup,'fixture.json'),JSON.stringify({platform:values.platform,deliveryPin:candidate.manifestSha256,
    contentPin:sha(readFileSync(join(fixture.directory,'manifest.json'))),deletionsPin:controlSha,identity,asset:fixture.asset,
    assetSha256:sha(shared),credentials:fixture.credentials,cookie:fixture.cookie,links:fixture.links,
    previousImageRef:previous.imageRef,previousIdentifiers:[previous.imageManifestSha256,previous.configSha256],
    candidateImageRef:candidate.imageRef,priorTarSha256:await fileDigest(beforeTar)}),{mode:0o600});
  // Only the previous program goes to the guest now. Its old content and the
  // owner's authority, Git worktrees and signing key stay on the workstation.
  await transfer(setup,['install.py','checks.py','fixture.json','tls','live'],guestRoot);
  guestOwned=true;
  await transfer(previousDir,['image.tar'],guestRoot);
  guest('mv',guestRoot+'/image.tar',guestRoot+'/prior-image.tar');
  guest('chown','-R','1000:1000',guestRoot+'/live');
  checked('initial-inventory','preload',false);
  const address=values['github-ip'] ?? (await lookup('github.com',{family:4})).address;
  observerRequested=true;
  observe('start',address,name);tracing=true;
  observe('host-probe');
  // Test a real container before transferring the previously absent candidate.
  const probeId=guest('docker','run','-d','--pull','never','--name',name+'-probe',previous.imageRef,'sleep','300');
  try {observe('container-probe',probeId);} finally {guest('docker','rm','-f',probeId);}
  await transfer(work,['incoming'],guestRoot);
  checked('import-new','install');
  checked('start-closed','start-candidate');checked('verify-closed','closed');
  async function updateControls(label, decision) {
    const current=ledger.read();
    assert.equal(decision.ledgerHead,current.ledgerHead);
    assert.equal(decision.deletionsSha256,current.deletionsSha256);
    await transfer(dirname(fixture.controlDirectory),[basename(fixture.controlDirectory),basename(fixture.settings)],guestRoot+'/next');
    const readback=checked(label,'controls');
    assert.equal(decision.checkpointSha256,readback.checkpointSha256);
    result.steps[label].verifiedLedgerHead=current.ledgerHead;persist();
  }
  await updateControls('publish-approval',fixture.open());
  checked('publish-listener','start-candidate');
  const published=checked('publish','audit-candidate');observe('container-probe',published.containerId);observe('snapshot','publish');
  checked('restart-listener','restart');
  const restarted=checked('restart','audit-candidate');
  assert.equal(restarted.containerId,published.containerId);
  assert.notEqual(restarted.startedAt,published.startedAt);
  assert.equal(restarted.imageId,published.imageId);
  assert.equal(restarted.checkpointSha256,published.checkpointSha256);
  observe('container-probe',restarted.containerId);observe('snapshot','restart');
  await updateControls('close-before-rollback',fixture.close());checked('closed-before-rollback','closed');
  checked('previous-listener-closed','start-before');checked('previous-closed','closed');
  await updateControls('rollback-approval',fixture.open());checked('previous-listener-open','start-before');
  const rolledBack=checked('rollback','audit-before');
  assert.notEqual(rolledBack.imageId,published.imageId);
  assert.equal(rolledBack.contentSha256,published.contentSha256);
  assert.deepEqual(rolledBack.authIdentity,published.authIdentity);
  for(const stage of [published,restarted,rolledBack]) assert.equal(stage.deletionsSha256,authority.deletionsSha256);
  observe('container-probe',rolledBack.containerId);observe('host-probe');observe('snapshot','rollback');
  result.functionalPassed=true;
  failureKind='evidence';
  const observation=observe('finish',name);tracing=false;
  result.observation=observation;
  persist();
  result.traceReview=collectOfflineEvidence(values.machine,observation,evidence);
  // The independent trace summary must also establish complete, clean coverage.
  // Keep functional and observation outcomes distinct if the guest cannot trace.
  assert.ok(result.traceReview.passed,result.traceReview.reason);
  result.passed=true;
} catch(error) {
  result.failureKind=failureKind;
  result.failure=String(error.message).split('\n')[0].slice(0,600);
  process.exitCode=1;
} finally {
  if (tracing) {try {result.observation=observe('finish',name);}catch{result.observationIncomplete=true;}}
  if (guestOwned) {
    try {
      const status=JSON.parse(guest('python3',guestRoot+'/checks.py',name,'cleanup'));
      assert.equal(status.cleaned,true);
      result.applicationCleaned=true;
    } catch(error) {
      result.cleanupFailure=String(error.message).split('\n')[0];
      result.passed=false;process.exitCode=1;
    }
  }
  if (observerRequested) {
    try {
      const status=JSON.parse(observe('abort',name));
      assert.equal(status.cleaned,true);
      assert.equal(status.run,name);
      writeFileSync(join(evidence,'observer-cleanup.json'),JSON.stringify(status)+'\n',{mode:0o600});
      result.observerCleaned=true;
    } catch(error) {
      result.cleanupFailure=String(error.message).split('\n')[0];
      result.passed=false;process.exitCode=1;
    }
  }
  result.cleaned=(!guestOwned || result.applicationCleaned===true) && (!observerRequested || result.observerCleaned===true);
  persist();
  rmSync(work,{recursive:true,force:true});
  console.log(evidence);
  if(!result.passed) console.error(result.failure);
}
