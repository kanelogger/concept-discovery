import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { copyFileSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, hash } from '../../lib/siyuan.mjs';
import { createWikiStore, sourceSnapshotId } from '../../lib/wiki-store.mjs';
import { buildContent } from '../../scripts/build-content.mjs';
import { freezeContentInputs } from '../../scripts/freeze-content-inputs.mjs';
import { openAuthStore } from '../../server/auth-store.mjs';
import { startContentShadow } from '../../scripts/start-content-shadow.mjs';
import { authHTTPSFixture, owner } from './auth-https-fixture.mjs';
import { writeJSON } from './runtime.mjs';

const cli=fileURLToPath(new URL('../../bin/concept-discovery.mjs',import.meta.url));
function callCLI(configuration,command,input) {
  return new Promise((yes,no)=>{
    const child=execFile(process.execPath,[cli,command],{env:{...process.env,CONCEPT_DISCOVERY_CONFIG:configuration}},(error,stdout,stderr)=>{
      if (error) { no(new Error(stderr)); return; }
      try { const response=JSON.parse(stdout);assert.equal(response.ok,true);yes(response.data); }
      catch (err) { no(err); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
async function availablePort() {
  const server=createServer();
  await new Promise((yes,no)=>server.once('error',no).listen(0,'127.0.0.1',yes));
  const port=server.address().port;
  await new Promise(yes=>server.close(yes));
  return port;
}
function rebaseLinks(record,oldOrigin,newOrigin) {
  if (Array.isArray(record)) return record.map(row=>rebaseLinks(row,oldOrigin,newOrigin));
  if (!record || typeof record!=='object') return record;
  return Object.fromEntries(Object.entries(record).map(([key,value])=>[key,
    key==='url' && typeof value==='string' && value.startsWith(oldOrigin+'/')
      ? newOrigin+value.slice(oldOrigin.length) : rebaseLinks(value,oldOrigin,newOrigin)]));
}

function seedHistory(root,libraryId) {
  const wiki=join(root,'wiki'), archive=createWikiStore(wiki,libraryId);
  const details={sourceId:'src_0123456789abcdea',title:'精确历史来源',author:'测试',url:'',markdown:'历史原文。'};
  const source=archive.restoreSource({...details,id:sourceSnapshotId(details),hash:hash(details.markdown),
    version:1,createdAt:'2026-11-01T08:00:00Z'});
  const base=join(wiki,hash(libraryId));
  const proposal={id:'prop_0123456789abcdef',kind:'proposal',title:'历史提案',sourceId:source.id,
    createdAt:source.createdAt,updatedAt:source.createdAt};
  writeJSON(join(base,'proposals',proposal.id+'.json'),{...proposal,revision:hash(canonical(proposal))});
  const event={id:'evt_0123456789abcdef',kind:'review',createdAt:source.createdAt};
  writeJSON(join(base,'events',event.id+'.json'),{record:event,recordHash:hash(canonical(event))});
  return {source,proposal,event};
}

async function compareShadowSharing({directory, state, libraryId, ordinaryId, rawId}) {
  const current=join(state,'current'), other=join(state,'other');
  for (const [root,title] of [[directory,'转发素材 A'],[other,'转发素材 B']]) {
    const materials=join(root,'share-materials'),covers=join(materials,'covers');
    mkdirSync(covers,{recursive:true});
    writeJSON(join(materials,'catalog.json'),{[rawId]:{id:rawId,cardTitle:'合成核查',title,description:'摘要'}});
    copyFileSync(new URL('../../web/share-cover.png',import.meta.url),join(covers,rawId+'.png'));
  }
  symlinkSync(directory,current,'dir');
  const config=join(state,'authenticated-shadow.json');
  const legacy = await authHTTPSFixture({retained:{id:ordinaryId,title:'合成核查',body:'冻结时的正文。'}});
  try {
    const post = (path,method,input,headers) => legacy.request(path,{method,data:input,headers:{Origin:legacy.url,...headers}});
    const login=await post('/api/session/login','POST',owner);
    assert.equal(login.status,200);
    const session={Cookie:login.headers['set-cookie'][0].split(';')[0]};
    const manage='/api/card-shares/'+ordinaryId;
    const issued=await post(manage,'PUT',{},session);
    assert.equal(issued.status,200);
    const share=issued.json().data, token=new URL(share.url).hash.slice(1), previewId=share.preview.id;
    const read=()=>post('/api/card-share/read','POST',{token,previewId});
    const expected=(await read()).json().data;
    assert.match(expected.html,/冻结时的正文/);
    await legacy.withShadow(async source=>{
      copyFileSync(source,join(state,'shadow-auth.sqlite'));
      writeJSON(config,{backend:'content-shadow',publicUrl:legacy.url,port:0,auth:{mode:'required',databaseFile:'shadow-auth.sqlite'},
        libraryId,agentTokenFile:'agent-token',contentRelease:current});
      return startContentShadow(config);
    },async()=>{
      unlinkSync(current); symlinkSync(other,current,'dir');
      assert.equal((await legacy.request('/api/session',{headers:session})).status,200);
      assert.deepEqual((await read()).json().data,expected);
      const retained=await legacy.request(manage,{headers:session});
      assert.equal(retained.json().data.url,share.url);
      const withdrawn=await post(manage,'DELETE',{token},session);
      assert.equal(withdrawn.status,200);
      assert.equal(withdrawn.json().data.suggestion.title,'转发素材 A');
      assert.equal((await read()).status,404);
      assert.equal((await legacy.request('/share/'+previewId)).status,404);
      assert.equal((await legacy.request('/share/'+previewId+'/cover')).status,404);
    });
    assert.deepEqual((await read()).json().data,expected,'candidate revocation must not touch the old auth DB');
    unlinkSync(current); symlinkSync(directory,current,'dir');
    const db=openAuthStore({databasePath:join(state,'shadow-auth.sqlite')});
    try { db.shares.suspendForDeletion(ordinaryId); } finally { db.close(); }
    await assert.rejects(startContentShadow(config),{code:'content_unavailable'});
    assert.equal((await read()).status,200);
  } finally { await legacy.close(); }
}

export async function compareContentShadow(instance,{libraryId,oldId,ordinaryId,readingId,blockId}) {
  const history=seedHistory(instance.root,libraryId);
  const fresh=join(instance.dir,'shadow-export');
  await instance.raw(fresh,'export',fresh);
  const inputs=join(instance.dir,'shadow-inputs');
  await freezeContentInputs({rawRoot:fresh,bindingsFile:join(fresh,'.sync.json'),frozenRoot:instance.root,libraryId,output:inputs});
  const directory=join(instance.dir,'shadow-release');
  buildContent({rawRoot:fresh,metadataFile:join(inputs,'metadata.json'),baselineFile:join(inputs,'history.json'),output:directory});

  const state=join(instance.dir,'shadow-state');
  mkdirSync(state,{mode:0o700});
  const port=await availablePort(), url='http://127.0.0.1:'+port, config=join(state,'shadow.json'), client=join(state,'client.json');
  writeFileSync(join(state,'agent-token'),randomUUID(),{mode:0o600});
  writeJSON(client,{url,tokenFile:'agent-token'});
  writeJSON(config,{backend:'content-shadow',publicUrl:url,port,auth:{mode:'local'},
    libraryId,agentTokenFile:'agent-token',contentRelease:directory,manifestSha256:hash(readFileSync(join(directory,'manifest.json')))});
  const shadow=await startContentShadow(config);
  try {
    const exercises=[
      ['list',{limit:20,includeTags:'page'}], ['search',{query:'校准 先验'}],
      ['get',{id:ordinaryId}],['get',{id:'concept:verified-model'}],['get-document',{id:oldId}],
      ['get-document',{id:blockId}],['get-document',{id:readingId}],['wiki-card',{id:oldId}],
      ['sources-list',{}],['source-get',{id:history.source.id}],['wiki-proposals',{}],
      ['wiki-proposal',{id:history.proposal.id}],['wiki-events',{}],
    ];
    for (const [command,input] of exercises) {
      const original=await instance.call(command,input);
      const expected=['get','get-document','search'].includes(command)?rebaseLinks(original,instance.url,url):original;
      const actual=await callCLI(client,command,input);
      assert.deepEqual(actual,expected,command+' '+Object.keys(input).join(','));
    }
    for (const name of ['graph','scenarios']) {
      const live=await (await fetch(instance.url+'/api/'+name)).json();
      const res=await fetch(url+'/api/'+name);assert.equal(res.status,200);assert.deepEqual(await res.json(),live);
      const cached=await fetch(url+'/api/'+name,{headers:{'If-None-Match':res.headers.get('etag')}});
      assert.equal(cached.status,304);assert.equal((await cached.arrayBuffer()).byteLength,0);
    }
    const deny=await fetch(url+'/api/v1/commands/save-document',{method:'POST',headers:{origin:url,'content-type':'application/json'},body:'{}'});
    assert.equal(deny.status,404);
    const exported=JSON.parse(readFileSync(join(fresh,'.sync.json'),'utf8'));
    const rawId=Object.keys(exported.cards).find(key=>exported.cards[key].remoteId===ordinaryId);
    assert.ok(rawId);
    await compareShadowSharing({directory,state,libraryId,ordinaryId,rawId});
    instance.record('shadow-http-cli-parity',{comparedCommands:new Set(exercises.map(([command])=>command)).size,
      examples:exercises.length,legacyGet:true,newGet:true,previousSessionAndShare:true,isolatedRevocation:true,graphAndAtlas:true,privateGet304:true,writeRefused:true,
      inventories:{sources:1,proposals:1,events:1},kernelOnCandidate:false});
  } finally {
    const closed=new Promise(yes=>shadow.close(yes));shadow.closeAllConnections();await closed;
  }
}
