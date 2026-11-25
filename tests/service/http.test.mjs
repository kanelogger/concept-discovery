import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseFragment} from 'parse5';
import { createApp,assetPath } from '../../server/app.mjs';
import { renderMarkdown } from '../../server/render.mjs';
import { loadServiceConfig } from '../../server/main.mjs';

// fetch owns Host and Sec-Fetch-Mode; use HTTP directly to exercise those boundaries.
const requestStatus=(url,headers)=>new Promise((resolve,reject)=>{
  const req=request(url,{headers},res=>{res.resume();res.once('end',()=>resolve(res.statusCode));});
  req.once('error',reject);req.end();
});

test('reader preserves ordinary content and safe legacy links without active HTML',()=>{
  const id='20261105000000-abcdefg';
  const html=renderMarkdown(`## 来源\n\n[方法](kane://blocks/${id}) 与 ((${id} "相关"))\n\n<img src="/assets/a.png" onerror="evil()">\n\n<a href="https://example.org">出处</a>\n\n<script>evil()</script>\n\n[bad](javascript:evil())\n\n\`<img src="literal">\`\n\n| 列 | 值 |\n|---|---|\n| a | b |`);
  assert.match(html,new RegExp('/\\?id='+id));
  assert.match(html,/<img src="\/assets\/a.png" alt="" loading="lazy">/);
  assert.match(html,/href="https:\/\/example.org"/);
  assert.match(html,/<table>/);
  assert.match(html,/<code>&lt;img src=/);
  assert.doesNotMatch(html,/<script|onerror=|href="javascript:|siyuan:\/\//);
  for(const value of ['/assets/../conf.json','/assets/%2e%2e%2fconf.json','/assets/%252e%252e/conf.json','/assets/a\\b','/conf/a'])assert.throws(()=>assetPath(value));
  assert.equal(assetPath('/assets/图.png'),'/data/assets/图.png');
});

test('relative SiYuan attachments resolve from nested card pages', () => {
  const cases = [
    ['![正文](assets/photo.png)', 'src="/assets/photo.png"'],
    ['![引用式图片][photo]\n\n[photo]: assets/%E5%9B%BE.png', 'src="/assets/%E5%9B%BE.png"'],
    ['[附件](assets/photo.png?version=1#preview)', 'href="/assets/photo.png?version=1#preview"'],
    ['<img src="assets/legacy.png" alt="旧卡" width="320">', 'src="/assets/legacy.png"'],
    ['正文 <img src="assets/inline.png" alt="行内图片">', 'src="/assets/inline.png"'],
    ['<a href="assets/download.png">附件</a>', 'href="/assets/download.png"'],
    ['![根路径](/assets/already.png)', 'src="/assets/already.png"'],
    ['![其他相对路径](notes/photo.png)', 'src="notes/photo.png"'],
    ['![外部图片](https://example.org/assets/photo.png)', 'src="https://example.org/assets/photo.png"'],
    ['[附注](assets/../guide.md)', 'href="assets/../guide.md"'],
  ];
  for (const [markdown, attribute] of cases) {
    assert.ok(renderMarkdown(markdown).includes(attribute), markdown + ' should render ' + attribute);
  }
});

test('only Kane card links navigate inside the application', () => {
  const id = '20261105000000-abcdefg';
  const html = renderMarkdown([
    `[新地址](kane://blocks/${id}) 与 [旧地址](siyuan://blocks/${id})`,
    `<a href="kane://blocks/${id}">旧 HTML 格式</a>`,
    `<a href="SIYUAN://blocks/${id}">旧协议</a>`,
    `<a href="si&#x0a;yuan://blocks/${id}">变形旧协议</a>`,
    '[不支持的地址](kane://outside/card)',
    `[不支持的参数](kane://blocks/${id}?x=1)`,
    `<a href="KANE://blocks/${id}">大写协议</a>`,
    `<a href="ka&#x0a;ne://blocks/${id}">协议内换行</a>`,
    `<a href="kane://blocks/${id}&#x0a;">末尾换行</a>`,
    `<a href="kane://blocks/other/../${id}">路径变形</a>`,
  ].join('\n\n'));
  assert.equal(html.split('href="/?id=' + id + '"').length - 1, 2);
  assert.equal(html.split('<a ').length - 1, 2);
  assert.doesNotMatch(html, /href="(?:kane|siyuan):/);
});

test('explicit local browser access needs no credentials while origin and independent Agent Token boundaries remain',async()=>{
  const calls=[];
  const origin='http://127.0.0.1';
  const server=createApp({authMode:'local',publicUrl:origin,agentToken:'agent-secret',api:{origin:'http://kernel:6806',c:{token:'kernel-secret'}},executeCommand:async(_api,name,input)=>{
    calls.push({name,input});if(name==='get-document')return {id:'20261105000000-abcdefg',editable:false,markdown:'# 旧标题\n\n旧格式中文正文：API 与 JavaScript。',blocks:[{id:'20261105000001-abcdefg',markdown:'# 旧标题'}]};if(input.fail)throw new Error('kernel-secret agent-secret');return {items:[]};
  }});
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const url='http://127.0.0.1:'+server.address().port;
  try{
    const call=(path,body,headers={})=>fetch(url+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
    const page=await fetch(url+'/');
    const policy=page.headers.get('content-security-policy');
    const nonce=policy.match(/'nonce-([^']+)'/)[1];
    assert.doesNotMatch(policy,/unsafe-inline|unsafe-eval/);
    assert.ok((await page.text()).includes('name="style-nonce" content="'+nonce+'"'));
    const second=await fetch(url+'/');
    assert.notEqual(second.headers.get('content-security-policy').match(/'nonce-([^']+)'/)[1],nonce);

    assert.equal(page.headers.get('set-cookie'),null);
    const status=await fetch(url+'/api/status');assert.equal(status.status,200);
    assert.deepEqual(await status.json(),{ok:true,data:{readOnly:true}});
    assert.equal(status.headers.get('set-cookie'),null);
    assert.equal(await requestStatus(url+'/cards',{'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'}),200);
    assert.equal((await fetch(url+'/api/status',{headers:{'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'}})).status,403);
    assert.equal((await fetch(url+'/api/status',{headers:{'sec-fetch-site':'same-site'}})).status,403);
    assert.equal((await fetch(url+'/api/status',{headers:{origin:'https://wrong.invalid'}})).status,403);
    assert.equal(await requestStatus(url+'/api/status',{host:'wrong.invalid'}),403);
    assert.equal((await fetch(url+'/api/status',{headers:{authorization:'Bearer kernel-secret'}})).status,401);
    for(const method of ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']){
      const removed=await fetch(url+'/api/session',{method,headers:{origin}});
      assert.equal(removed.status,404,method);assert.equal(removed.headers.get('set-cookie'),null);
    }
    assert.equal((await call('/api/v1/commands/list',{})).status,403);
    assert.equal((await call('/api/v1/commands/list',{}, {authorization:'Bearer kernel-secret'})).status,401);
    assert.equal((await call('/api/v1/commands/list',{}, {authorization:'Basic invalid',origin})).status,401);
    assert.equal((await call('/api/v1/commands/list',{}, {authorization:'Bearer wrong',origin})).status,401);
    assert.equal((await call('/api/v1/commands/list',{}, {authorization:'Bearer wrong',origin:'https://wrong.invalid'})).status,401);
    assert.equal((await call('/api/v1/commands/list',{}, {origin:'https://wrong.invalid'})).status,403);
    assert.equal((await call('/api/v1/commands/list',{}, {origin:origin+':6806'})).status,403);
    assert.equal((await call('/api/v1/commands/list',{}, {origin,'sec-fetch-site':'cross-site'})).status,403);
    assert.equal((await call('/api/v1/commands/list',{}, {origin,'sec-fetch-site':'same-site'})).status,403);
    const browser=await call('/api/v1/commands/list',{}, {origin});assert.equal(browser.status,200);assert.equal(browser.headers.get('set-cookie'),null);
    assert.equal((await call('/api/v1/commands/list',{}, {authorization:'Bearer agent-secret'})).status,200);
    assert.equal((await call('/api/v1/commands/init',{}, {authorization:'Bearer agent-secret'})).status,404);
    assert.equal((await call('/api/query/sql',{}, {authorization:'Bearer agent-secret'})).status,404);
    assert.equal(calls.length,2);
    const old=await call('/api/v1/commands/get-document',{id:'20261105000000-abcdefg'},{authorization:'Bearer agent-secret'});
    const legacy=(await old.json()).data;assert.match(legacy.html,/旧格式中文正文：/);assert.match(legacy.html,/API 与 JavaScript/);
    const failure=await call('/api/v1/commands/list',{fail:true},{authorization:'Bearer agent-secret'});
    const text=await failure.text();assert.doesNotMatch(text,/kernel-secret|agent-secret/);
    assert.equal((await call('/api/v1/commands/list',{}, {cookie:'cd_session=obsolete',origin})).status,200);
  }finally{await new Promise(ok=>server.close(ok));}
});

test('local anonymous attachment reads stay same-origin and verify the configured hostname',async t=>{
  let reads=0;
  const kernel=createServer(async(req,res)=>{
    assert.equal(req.url,'/api/file/getFile');assert.equal(req.headers.authorization,'Token kernel-fixture');
    reads++;res.setHeader('Content-Type','image/png');res.end('fixture-image');
  });
  await new Promise(resolve=>kernel.listen(0,'127.0.0.1',resolve));
  const app=createApp({authMode:'local',publicUrl:'http://127.0.0.1',agentToken:'agent-fixture',api:{origin:'http://127.0.0.1:'+kernel.address().port,c:{token:'kernel-fixture'}}});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>app.close(resolve));await new Promise(resolve=>kernel.close(resolve));});
  const url='http://127.0.0.1:'+app.address().port+'/assets/image.png';
  const image=await fetch(url,{headers:{'sec-fetch-site':'same-origin'}});
  assert.equal(image.status,200);assert.equal(await image.text(),'fixture-image');assert.equal(image.headers.get('set-cookie'),null);
  for(const headers of [{origin:'https://wrong.invalid'},{'sec-fetch-site':'cross-site'},{'sec-fetch-site':'same-site'},{host:'rebound.invalid'},{authorization:'Bearer invalid'}])assert.notEqual(await requestStatus(url,headers),200,JSON.stringify(headers));
  assert.equal(reads,1);
});

test('reader startup ignores retired access codes, model credentials and stored model settings',t=>{
  const root=mkdtempSync(join(tmpdir(),'cd-service-config-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  writeFileSync(join(root,'agent-token'),'fixture-agent');writeFileSync(join(root,'kernel-token'),'fixture-kernel');
  writeFileSync(join(root,'kernel.json'),JSON.stringify({url:'http://kernel:6806',tokenFile:'kernel-token',internal:true}));
  const file=join(root,'service.json');
  for(const legacy of [{},{accessCodeFile:'does-not-exist',llm:{baseUrl:'https://unused.example/v1',model:'retired',apiKeyFile:'does-not-exist'}}]){
    writeFileSync(file,JSON.stringify({auth:{mode:'local'},publicUrl:'http://127.0.0.1',agentTokenFile:'agent-token',kernelConfig:'kernel.json',...legacy}));
    const config=loadServiceConfig(file);assert.equal(config.agentToken,'fixture-agent');assert.equal(config.kernelConfig.token,'fixture-kernel');
    assert.equal(Object.hasOwn(config,'accessCode'),false);
    assert.equal(Object.hasOwn(config,'modelSettings'),false);
    assert.equal(Object.hasOwn(config,'llm'),false);
  }
});


test('legacy HTML attributes and source links survive Markdown punctuation',()=>{
  const output=renderMarkdown('<img src="/assets/a.png" alt="**图** &quot;记录&quot;" onerror="evil()">\n\n来源：<a href="https://example.org">**重点来源**</a>');
  const nodes=[];const visit=node=>{nodes.push(node);for(const child of node.childNodes??[])visit(child);};visit(parseFragment(output));
  const image=nodes.find(node=>node.tagName==='img');assert.ok(image);
  const attrs=Object.fromEntries(image.attrs.map(({name,value})=>[name,value]));
  assert.equal(attrs.src,'/assets/a.png');assert.equal(attrs.alt,'**图** "记录"');assert.equal(attrs.onerror,undefined);
  const anchor=nodes.find(node=>node.tagName==='a');assert.ok(anchor);
  assert.equal(anchor.attrs.find(({name})=>name==='href').value,'https://example.org');
  const text=node=>node.nodeName==='#text'?node.value:(node.childNodes??[]).map(text).join('');
  assert.match(text(anchor),/重点来源/);
  const code=renderMarkdown('`<img src="x" alt="**literal**">`');assert.doesNotMatch(code,/<img/);assert.match(code,/<code>/);
  assert.doesNotMatch(renderMarkdown('<a href="javascript:evil()">来源</a>'),/<a /);
  assert.doesNotMatch(renderMarkdown('<a href="java&#x09;script:evil()">来源</a>'),/<a /);
  assert.doesNotMatch(renderMarkdown('<img src="java&#x0a;script:evil()" alt="图">'),/<img /);
  assert.match(renderMarkdown('<template>原文内容</template>'),/原文内容/);
});

test('legacy card display omits empty fixed fields while preserving filled fields and regular headings',()=>{
  const markdown = '## 中文 · 封面\n\n\u200b\n\n## 中文 · 标签\n\n## 中文 · 图片\n\n![例图](/assets/example.png)\n\n## 中文 · 补充说明\n\n\u200b\n\n保留后续内容。\n\n## 备注\n\n\u200b';
  const html = renderMarkdown(markdown,{legacyFixedFields:true});
  assert.doesNotMatch(html,/中文 · 封面|中文 · 标签/);
  assert.match(html,/中文 · 图片/);
  assert.match(html,/<img src="\/assets\/example.png"/);
  assert.match(html,/中文 · 补充说明/);
  assert.match(html,/保留后续内容/);
  assert.match(html,/<h2>备注<\/h2>/);
  assert.match(renderMarkdown(markdown),/中文 · 封面/);
});

test('legacy card HTML preserves Chinese prose, technical names, code and source URLs',()=>{
  const markdown = '# 回想：问题\n\n## 中文 · 名称\n\n示例卡\n\n## 中文 · 理解\n\n用 API 连接 JavaScript。\n\n`const locale = "en"`\n\nhttps://example.org/original\n\n## 个人补记\n\n保留正文。';
  const html = renderMarkdown(markdown,{legacyFixedFields:true});
  assert.match(html,/用 API 连接 JavaScript/);
  assert.match(html,/<code>const locale = &quot;en&quot;<\/code>/);
  assert.match(html,/href="https:\/\/example.org\/original"/);
  assert.match(html,/保留正文/);
});

test('read-only detail resolves whole-document links and preserves native block anchors', async t => {
  const first = '20261105000000-abcdefg';
  const second = '20261105000001-abcdefg';
  const third = '20261105000002-abcdefg';
  const definitionId = '20261105000003-abcdefg';
  const paragraph = '[读出处][source] 或访问 https://example\\.org/guide\\-1、www.example.org/manual。';
  const definition = '[source]: https://example.org/original';
  const image = '<img src="/assets/example.png" alt="例图">';
  const markdown = [paragraph, definition, image, paragraph].join('\n\n');
  const blocks = [
    { id: first, markdown: paragraph },
    { id: definitionId, markdown: definition },
    { id: second, markdown: image },
    { id: third, markdown: paragraph },
  ];
  const server = createApp({
    authMode: 'local',
    publicUrl: 'http://127.0.0.1',
    agentToken: 'agent-secret',
    api: { origin: 'http://kernel:6806', c: { token: 'kernel-secret' } },
    executeCommand: async () => ({ markdown, blocks, editable: true }),
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const call = async (path, body) => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + path, {
      method: 'POST',
      headers: { authorization: 'Bearer agent-secret', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200);
    const data = (await response.json()).data;
    assert.equal(data.editable, false);
    assert.equal(data.deletable, false);
    assert.equal(data.question, "");
    return data.html;
  };
  const detail = await call('/api/v1/commands/get-document', { id: first });
  const preview = renderMarkdown(markdown);
  assert.match(preview, /href="https:\/\/example\.org\/original"/);
  assert.match(preview, /href="https:\/\/example\.org\/guide-1"/);
  assert.match(preview, /href="https:\/\/www\.example\.org\/manual"/);
  for (const id of [first, second, third, definitionId]) assert.match(detail, new RegExp('id="' + id + '"'));
  assert.equal(detail.replace('<span id="' + definitionId + '"></span>', '').replace(/ id="\d{14}-[a-z0-9]{7}"/g, ''), preview);
});

test('bare addresses do not become links to a truncated destination', () => {
  const html = renderMarkdown('https://example.org/中文路径\n\nhttps://example.org/a!b');
  assert.doesNotMatch(html, /<a /);
  assert.match(html, /https:\/\/example\.org\/中文路径/);
  assert.match(html, /https:\/\/example\.org\/a!b/);
  const parenthesized = renderMarkdown('(https://example.org/path(foo))。');
  assert.match(parenthesized, /href="https:\/\/example\.org\/path\(foo\)"/);
});
