import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../../server/app.mjs';
import { takeInitialPage } from '../../web/initial-page.mjs';

function extract(page) {
  const match=page.match(/<script type="application\/json" id="initial-page">([\s\S]*?)<\/script>/);
  return match ? JSON.parse(match[1]) : null;
}

test('only a private current reading page embeds its scoped initial read after checking the session',async t=>{
  const session={publicId:'owner-public',expiresAt:Date.now()+300000};
  let active=true, revokeDuringDispatch=false;
  const label='比对 <模型> & "问题"、$& 和 </script>';
  const rows=[{id:'new',title:label,tags:[]}];
  const contentReader={
    activeMain(ref){return ref==='new'?{id:'new',rawId:'new',title:label}:null;},
    dispatch(command,input) {
      if(revokeDuringDispatch)active=false;
      if(command==='list')return {items:rows,offset:input.offset,limit:input.limit,total:1,hasMore:false};
      assert.equal(command,'get-document');
      if(input.id!=='new')throw Object.assign(new Error('missing'),{code:'not_found'});
      return {id:input.id,title:label,html:'<p>正文</p>',question:'问题',markdown:'正文',blocks:[],readings:[]};
    },
  };
  const app=createApp({contentReader,publicUrl:'https://127.0.0.1',agentToken:'fixture-agent',
    authStore:{session:token=>active&&token==='owner-cookie-secret'?session:null,shares:{fencedIds:()=>[],fencedForDeletion:()=>false}}});
  t.after(async()=>{const done=new Promise(yes=>app.close(yes));app.closeAllConnections();await done;});
  await new Promise((yes,no)=>app.once('error',no).listen(0,'127.0.0.1',yes));
  const request=(path,owner=true)=>fetch('http://127.0.0.1:'+app.address().port+path,{redirect:'manual',
    headers:owner?{cookie:'__Host-cd-session=owner-cookie-secret'}:{}});
  const noSession=await request('/cards',false);
  assert.equal(noSession.status,401); assert.equal(extract(await noSession.text()),null);
  const list=await request('/cards?q=probe&page=2&tag=type');
  assert.equal(list.headers.get('cache-control'),'no-store');
  const html=await list.text();
  assert.ok(!html.includes('owner-cookie-secret')&&!html.includes(label));
  const payload=extract(html);
  assert.deepEqual(payload.session,{publicId:session.publicId});
  assert.deepEqual(payload.read.input,{query:'probe',updatedFrom:'',updatedTo:'',offset:20,limit:20,tag:'type',includeTags:true});
  assert.deepEqual(payload.read.data.items,rows);
  const detail=extract(await (await request('/?id=new')).text()).read;
  assert.equal(detail.command,'get-document');
  assert.equal(detail.data.shareable,true);
  for (const path of ['/share','/wiki','/graph','/cards/new','/cards/missing']) {
    assert.equal(extract(await (await request(path)).text()),null,path);
  }
  revokeDuringDispatch=true;
  const expired=await request('/cards');
  assert.equal(expired.status,401);
  assert.equal(extract(await expired.text()),null);
});

test('client consumes a seed exactly once and drops it on mismatched queries, hidden or restored pages',()=>{
  function fixture({path='/cards',visibility='visible',type='navigate'}={}) {
    let node={tagName:'SCRIPT',type:'application/json',textContent:JSON.stringify({route:'/cards',read:{value:1}}),remove:()=>{node=null;}};
    return {document:{getElementById:()=>node,visibilityState:visibility},
      location:{href:'http://localhost'+path},performance:{getEntriesByType:()=>[{type}]}};
  }
  const page=fixture();assert.ok(takeInitialPage(page));assert.equal(takeInitialPage(page),null);
  for(const option of [{path:'/cards?q=changed'},{visibility:'hidden'},{type:'back_forward'}]){
    const stale=fixture(option);assert.equal(takeInitialPage(stale),null);assert.equal(takeInitialPage(stale),null);
  }
});
