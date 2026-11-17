import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../../server/app.mjs';

test('wiki HTTP commands retain session/token isolation, origin checks and private source scope',async()=>{
  const root=mkdtempSync(join(tmpdir(),'cd-wiki-http-'));
  const origin='http://127.0.0.1';
  const app=createApp({publicUrl:origin,agentToken:'fixture-agent',accessCode:'fixture-access',logDraft:()=>{},
    api:{c:{dataDir:join(root,'operations')},identity:async()=>'fixture-library'},wikiRoot:join(root,'wiki')});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  const url=origin+':'+app.address().port;
  const post=(name,input,headers={})=>fetch(url+'/api/v1/commands/'+name,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(input)});
  try{
    assert.equal((await fetch(url+'/wiki')).status,200);
    assert.equal((await post('sources-list',{})).status,401);
    const login=await fetch(url+'/api/session',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({accessCode:'fixture-access'})});
    const cookie=login.headers.get('set-cookie');assert.ok(cookie);
    const input={op_id:'source-http',title:'来源测试',markdown:'未经用户选择，不应写入卡片。\n\n<script>bad()</script>',url:'https://example.org/source'};
    assert.equal((await post('source-import',input,{cookie,origin:'https://wrong.invalid'})).status,403);
    assert.equal((await post('source-import',input,{cookie})).status,403);
    const response=await post('source-import',input,{cookie,origin});assert.equal(response.status,200);
    const source=(await response.json()).data;assert.equal(source.markdown,input.markdown);
    const auth={authorization:'Bearer fixture-agent'};
    const listed=(await(await post('sources-list',{},auth)).json()).data;
    assert.equal(listed.items.length,1);assert.equal(listed.items[0].id,source.id);
    const read=(await(await post('source-get',{id:source.id},auth)).json()).data;
    assert.equal(read.hash,source.hash);assert.equal(read.markdown,input.markdown);
    const denied=await post('source-get',{id:'../../service.json'},auth);assert.notEqual(denied.status,200);
    assert.equal((await fetch(url+'/wiki/sources/'+source.id,{headers:auth})).status,404);
    assert.equal((await post('wiki-draft',{sourceId:source.id},auth)).status,503);
    for(const command of ['ask','polish-description','wiki-propose','wiki-apply','wiki-understanding','wiki-recover']) assert.equal((await post(command,{},auth)).status,404,command);
    await fetch(url+'/api/session',{method:'DELETE',headers:{cookie,origin}});
    assert.equal((await post('source-get',{id:source.id},{cookie,origin})).status,401);
  }finally{await new Promise(resolve=>app.close(resolve));rmSync(root,{recursive:true,force:true});}
});
