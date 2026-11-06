import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFragment} from 'parse5';
import { createApp,assetPath } from '../../server/app.mjs';
import { renderMarkdown } from '../../server/render.mjs';

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

test('application requires credentials, separates sessions and limits public commands',async()=>{
  const calls=[];
  const origin='http://127.0.0.1';
  const server=createApp({publicUrl:origin,agentToken:'agent-secret',accessCode:'access-secret',api:{origin:'http://kernel:6806',c:{token:'kernel-secret'}},executeCommand:async(_api,name,input)=>{
    calls.push({name,input});if(name==='get-document')return {id:'20261105000000-abcdefg',editable:false,markdown:'# 旧标题\n\n旧格式中文正文。\n\nLegacy content.',blocks:[{id:'20261105000001-abcdefg',markdown:'# 旧标题'}]};if(input.fail)throw new Error('kernel-secret agent-secret');return {items:[]};
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

    assert.equal((await call('/api/v1/commands/list',{})).status,401);
    assert.equal((await call('/api/v1/commands/list',{}, {authorization:'Bearer kernel-secret'})).status,401);
    assert.equal((await call('/api/session',{accessCode:'access-secret'},{origin:'https://wrong.invalid'})).status,403);
    const login=await call('/api/session',{accessCode:'access-secret'},{origin});assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie');assert.match(cookie,/HttpOnly; SameSite=Strict/);
    assert.equal((await call('/api/v1/commands/list',{}, {cookie})).status,403);
    assert.equal((await call('/api/v1/commands/list',{}, {cookie,origin})).status,200);
    assert.equal((await call('/api/v1/commands/init',{}, {authorization:'Bearer agent-secret'})).status,404);
    assert.equal((await call('/api/query/sql',{}, {authorization:'Bearer agent-secret'})).status,404);
    assert.equal(calls.length,1);
    const old=await call('/api/v1/commands/get-document',{id:'20261105000000-abcdefg'},{authorization:'Bearer agent-secret'});
    const legacy=(await old.json()).data;assert.match(legacy.html,/旧格式中文正文。/);assert.match(legacy.html,/Legacy content/);
    const failure=await call('/api/v1/commands/list',{fail:true},{authorization:'Bearer agent-secret'});
    const text=await failure.text();assert.doesNotMatch(text,/kernel-secret|agent-secret/);
    await fetch(url+'/api/session',{method:'DELETE',headers:{cookie,origin}});
    assert.equal((await call('/api/v1/commands/list',{}, {cookie,origin})).status,401);
  }finally{await new Promise(ok=>server.close(ok));}
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
  const markdown = '## 中文 · 封面\n\n\u200b\n\n## 中文 · 标签\n\n## 中文 · 图片\n\n![例图](/assets/example.png)\n\n## 中文 · 补充说明\n\n\u200b\n\n保留后续内容。\n\n## 备注\n\n\u200b\n\n## English · 别名';
  const html = renderMarkdown(markdown,{legacyFixedFields:true});
  assert.doesNotMatch(html,/中文 · 封面|中文 · 标签|English · 别名/);
  assert.match(html,/中文 · 图片/);
  assert.match(html,/<img src="\/assets\/example.png"/);
  assert.match(html,/中文 · 补充说明/);
  assert.match(html,/保留后续内容/);
  assert.match(html,/<h2>备注<\/h2>/);
  assert.match(renderMarkdown(markdown),/中文 · 封面/);
});

test('legacy card HTML prefers Chinese and retains English-only cards',()=>{
  const cn = '# 回想：问题\n\n## 中文 · 名称\n\n示例卡\n\n## 中文 · 理解\n\n中文正文';
  const en = '# Recall: Question\n\n## English · 名称\n\nExample\n\n## English · 理解\n\nEnglish body';
  const appendix = '## 个人补记\n\n补记正文';
  const html = renderMarkdown([cn,en,appendix].join('\n\n'),{legacyFixedFields:true});
  assert.match(html,/中文正文/);
  assert.match(html,/补记正文/);
  assert.doesNotMatch(html,/Recall|English body/);
  assert.match(renderMarkdown('## 中文 · 名称\n\n'+en,{legacyFixedFields:true}),/English body/);
  assert.match(renderMarkdown([cn,en].join('\n\n')),/English body/);
});

test('detail and preview resolve whole-document links and preserve visible block anchors', async t => {
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
    publicUrl: 'http://127.0.0.1',
    agentToken: 'agent-secret',
    accessCode: 'access-secret',
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
    return (await response.json()).data.html;
  };
  const [preview, detail] = await Promise.all([
    call('/api/preview', { markdown }),
    call('/api/v1/commands/get-document', { id: first }),
  ]);
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
