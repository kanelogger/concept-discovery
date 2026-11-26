import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createApp } from '../../server/app.mjs';
import { cardShareStore } from '../../server/card-share-store.mjs';

const origin = 'https://127.0.0.1';
const owner = {Cookie: '__Host-cd-session=fixture-owner'};
const agent = {Authorization: 'Bearer fixture-agent'};
const original = '20261126000000-oldcard';
const alias = '曾用名';
const fresh = 'new-card';
const block = '20261126000001-oldcard';
const image = '/assets/' + 'a'.repeat(64) + '.png';
const picture = new URL('../../web/share-cover.png', import.meta.url);

async function fixture(t) {
  const db = new DatabaseSync(':memory:');
  const shares = cardShareStore(db);
  const state = {session: true, active: new Set([original, fresh]), image: true, version: 1, ready: true};
  const ids = new Map([[original, original], [alias, original], [fresh, fresh]]);
  const contentReader = {
    activeMain(ref) {
      const id = ids.get(ref);
      return state.active.has(id) ? {id, title: '主卡', rawId: id === original ? 'old-card' : fresh} : null;
    },
    async dispatch(command, {id}, {publicUrl, signal}) {
      assert.equal(publicUrl, origin);
      assert.ok(command === 'get-document');
      await state.beforeDocument?.();
      signal?.throwIfAborted();
      return {id: ids.get(id) ?? (id === block ? original : id), title:'主卡', html:'<p>编译阶段的锚点</p>',
        markdown:'冻结正文。\n\n![图](' + image + ')', question:'冻结问题', editable:false, deletable:false,
        ...(id === block && {anchor:block})};
    },
    async readView(name) {
      await state.beforeView?.();
      return {body:Buffer.from(JSON.stringify({ok:true,data:{name,version:state.version}})), etag:'"' + name + ',' + state.version + '"'};
    },
    readAsset(path, signal) {
      signal.throwIfAborted();
      if (state.image && [image, '/assets/旧 图.png'].includes(path))
        return new Response(readFileSync(picture), {headers:{'Content-Type':'image/png', ETag:'"image"'}});
      return new Response(null, {status:404});
    },
  };
  const app = createApp({
    publicUrl: origin, agentToken:'fixture-agent', contentReader,
    authStore:{shares, session: token => state.session && token === 'fixture-owner' ? {publicId:'owner'} : null},
    wechatShare:{async sign() {await state.beforeSign?.(); return {signature:'fixture'};}},
    getShareMaterial(info) {
      return info.rawId === 'old-card' ? {title:'转发标题', description:'摘要', cover:picture} : {title:info.title, description:''};
    },
    requireLifecycleReadiness:true, lifecycle:{ready:()=>({ready:state.ready})},
  });
  t.after(async () => {
    if (app.listening) await new Promise(resolve => {app.close(resolve); app.closeAllConnections();});
    db.close();
  });
  await new Promise((resolve, reject) => {app.once('error',reject); app.listen(0,'127.0.0.1',resolve);});
  function request(path, {method='GET', headers={}, data} = {}) {
    return fetch('http://127.0.0.1:' + app.address().port + path, {
      method, headers:{Origin:origin, ...headers, ...(data && {'Content-Type':'application/json'})},
      body:data && JSON.stringify(data), redirect:'manual',
    });
  }
  const manage = (ref,method='GET',data) => request('/api/card-shares/' + encodeURIComponent(ref),{method,data,headers:owner});
  const read = token => request('/api/card-share/read',{method:'POST',data:{token}});
  return {state,shares,request,manage,read};
}

async function data(response) {
  assert.equal(response.status, 200);
  return (await response.json()).data;
}
function noStore(response, status) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.has('etag'),false);
}

test('candidate serves compiled details and grants sharing only to the owner reading an active main identity', async t => {
  const {request, shares} = await fixture(t);
  const detail = (id, headers) => request('/api/v1/commands/get-document', {method:'POST',data:{id},headers});
  noStore(await detail(original, {}),401);
  assert.equal((await request('/api/card-shares/' + original,{headers:agent})).status,401);
  for (const [id, headers, permitted] of [[alias,owner,true], [fresh,owner,true], [block,owner,false], ['supplement',owner,false], [fresh,agent,false]]) {
    const response = await detail(id,headers);
    noStore(response,200);
    const doc = await data(response);
    assert.equal(doc.html, '<p>编译阶段的锚点</p>');
    assert.equal(doc.question,'冻结问题');
    assert.equal(doc.shareable,permitted || undefined);
    assert.equal(doc.deletable,false);
    assert.equal(doc.editable,false);
    assert.equal(doc.canArchive,undefined);
  }
  shares.suspendForDeletion(original);
  noStore(await detail(alias,owner),503);
  noStore(await detail(original,agent),503);
  noStore(await request('/api/graph',{headers:{...owner,'If-None-Match':'*'}}),503);
  noStore(await request(image,{headers:{...owner,'If-None-Match':'*'}}),503);
  noStore(await request('/api/v1/commands/save-document', {method:'POST',headers:agent,data:{}}),404);
});

test('candidate private conditional GET checks authorization, availability and representation before 304', async t => {
  const {state,request} = await fixture(t);
  const get = (path, condition, headers=owner) => request(path, {headers:{...headers,'If-None-Match':condition}});
  const graph = '/api/graph', scenarios = '/api/scenarios';
  const first = await get(graph,'"old"');
  assert.equal(first.headers.get('cache-control'),'private, no-cache');
  assert.equal(first.headers.get('etag'),'"graph,1"');
  assert.deepEqual(await data(first), {name:'graph',version:1});
  for (const condition of ['W/"graph,1"', '"other", W/"graph,1", "more"', '*']) {
    const cached = await get(graph,condition);
    assert.equal(cached.status,304);
    assert.equal(cached.headers.get('etag'),'"graph,1"');
    assert.equal(await cached.text(),'');
  }
  assert.equal((await get(scenarios,'"graph,1"')).status,200);
  state.version = 2;
  assert.equal((await get(graph,'"graph,1"')).headers.get('etag'),'"graph,2"');
  assert.equal((await get(image,'"unrelated"')).status,200);
  const cachedImage = await get(image,'W/"image"');
  assert.equal(cachedImage.status,304);
  assert.equal(cachedImage.headers.get('content-security-policy'),"default-src 'none'; sandbox");
  noStore(await get('/assets/%E6%97%A7%20%E5%9B%BE.png','*'),200);
  noStore(await get('/assets/missing.png','*'),404);
  noStore(await get(graph,'*',agent),401);
  noStore(await get(image,'*',{...owner,Origin:'https://invalid.example'}),403);
  state.image = false;
  noStore(await get(image,'"image"'),404);
  state.ready = false;
  noStore(await get(scenarios,'*'),503);
  state.ready = true;
  state.beforeView = () => {state.session = false;};
  noStore(await get(graph,'*'),401);
  noStore(await get(image,'*'),401);
});

test('aliases and new slugs use one persistent share identity across legacy upgrade, public reads and revocation', async t => {
  const {state,shares,request,manage,read} = await fixture(t);
  const token = shares.create(original,0,{title:'创建时的标题',html:'<p>旧版冻结正文</p>'});
  assert.equal((await data(await manage(alias))).url, origin+'/share#'+token);
  const suggestion = (await data(await manage(alias))).suggestion;
  assert.equal(suggestion.title,'转发标题');
  noStore(await request(suggestion.image),401);
  noStore(await request(suggestion.image,{headers:owner}),200);
  const {url,preview} = await data(await manage(alias,'PATCH',{token,version:0}));
  assert.equal(new URL(url).hash.slice(1),token);
  assert.equal((await data(await read(token))).html,'<p>旧版冻结正文</p>');
  noStore(await manage(alias,'PATCH',{token,version:0}),409);
  const page = new URL(url).pathname, cover = new URL(preview.image).pathname;
  for (const path of [page,cover]) noStore(await request(path),200);
  assert.ok(!(await (await request(page)).text()).includes('旧版冻结正文'));
  state.active.delete(original);
  for (const path of [page,cover]) noStore(await request(path,{method:'HEAD',headers:{'If-None-Match':'*'}}),404);
  noStore(await read(token),404);
  state.active.add(original);
  const signing = Promise.withResolvers(), release = Promise.withResolvers();
  state.beforeSign = () => {signing.resolve(); return release.promise;};
  const signed = request('/api/card-share/wechat-config', {method:'POST',data:{token,previewId:preview.id,url:origin+page}});
  try {
    await signing.promise;
    noStore(await manage(alias,'DELETE',{token}),200);
  } finally {release.resolve();}
  noStore(await signed,404);
  noStore(await read(token),404);
  const replacement = await data(await manage(alias,'PUT'));
  const next = new URL(replacement.url).hash.slice(1);
  assert.equal(shares.state(original).token,next);
  assert.equal(shares.state(alias).token,null);
  assert.match((await data(await read(next))).html,/data:image\/png;base64,/);
  noStore(await manage(alias,'DELETE',{token}),409);
  shares.purge(original);
  for (const ref of [alias,original,block,'supplement']) noStore(await manage(ref,'PUT'),404);
  noStore(await read(next),404);
  assert.equal((await data(await manage(fresh))).suggestion.title,'主卡');
  const created = await data(await manage(fresh,'PUT'));
  assert.equal(created.preview.image, origin + '/share-cover.png');
  const slugToken = new URL(created.url).hash.slice(1);
  assert.equal(shares.state(fresh).token,slugToken);
  noStore(await manage(fresh,'DELETE',{token:slugToken}),200);
  noStore(await read(slugToken),404);
});

test('delayed candidate share creation respects stable-id generation and owner session revocation', async t => {
  const {state,shares,manage} = await fixture(t);
  for (const status of [409,401]) {
    const entered = Promise.withResolvers(), release = Promise.withResolvers();
    state.beforeDocument = () => {state.beforeDocument = null; entered.resolve(); return release.promise;};
    const pending = manage(alias,'PUT');
    try {
      await entered.promise;
      if (status === 409) {
        const {url} = await data(await manage(original,'PUT'));
        noStore(await manage(original,'DELETE',{token:new URL(url).hash.slice(1)}),200);
      } else state.session = false;
    } finally {release.resolve();}
    noStore(await pending,status);
    assert.equal(shares.state(original).token,null);
  }
});


test('the owner can revoke the frozen link of an archived card by its stored public ID', async t=>{
  const {state,manage,read,request}=await fixture(t);
  const issued=await data(await manage(original,'PUT'));
  const token=new URL(issued.url).hash.slice(1);
  state.active.delete(original);
  noStore(await read(token),404);
  noStore(await request('/api/card-shares/'+original,{method:'DELETE',data:{token}}),401);
  noStore(await manage(original,'DELETE',{token}),200);
  state.active.add(original);
  noStore(await read(token),404);
  assert.equal((await data(await manage(original))).url,null);
});
