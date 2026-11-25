import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, appendFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../../scripts/raw.mjs',import.meta.url));

// Exercise the host CLI, the target/mount checks, private maintenance writes, and the existing reader.
export async function verifyRawCli(instance) {
  const raw = join(instance.dir,'raw-cli-input');
  const root = join(raw,'方法');
  const a = join(root,'scientific-question'), b = join(root,'competing-explanation');
  mkdirSync(join(a,'assets'),{recursive:true});
  mkdirSync(b,{recursive:true});
  const material = '第一行原始资料。\r\n第二行，保留换行。\r\n';
  writeFileSync(join(a,'assets/record.md'),material);
  const fileBytes = Buffer.from('local-attachment\n');
  writeFileSync(join(a,'assets/notes.txt'),fileBytes);
  writeFileSync(join(a,'article.md'),'---\nname: 原稿集成甲\nsources: [assets/record.md]\n---\n\n## 核心理解\n\n先比较[[competing-explanation|另一个解释]]。见[附件](assets/notes.txt)。\n');
  writeFileSync(join(b,'article.md'),'---\nname: 原稿集成乙\n---\n\n## 核心理解\n\n[先写问题](../scientific-question/article.md)，再补充证据。\n');
  const literal = 'echo $$ $&';
  appendFileSync(join(b,'article.md'), '\n```sh\n' + literal + '\n```\n');
  const env = join(instance.root,'compose.env');
  const bytes = readFileSync(env);
  try {
    // The test harness selects its project with docker compose -p, independently of the private config.
    appendFileSync(env,'\nCOMPOSE_PROJECT_NAME='+instance.name+'\n');
    const call = async (...args) => JSON.parse((await run(process.execPath,[cli,...args,'--raw-root',raw,'--private-root',instance.root,'--json'],
      {encoding:'utf8',timeout:120000})).stdout);
    assert.equal((await call('check')).cards,2);
    const wrongRoot = join(instance.dir,'different-private-root');
    mkdirSync(wrongRoot);
    writeFileSync(join(wrongRoot,'service.json'), '{}');
    writeFileSync(join(wrongRoot,'compose.env'), `COMPOSE_PROJECT_NAME=${instance.name}\nCONCEPT_PRIVATE_ROOT=${wrongRoot}\nKERNEL_ACCESS_CODE=unused\n`);
    await assert.rejects(run(process.execPath,[cli,'sync','--raw-root',raw,'--private-root',wrongRoot]),
      error => error.stderr.includes('挂载与所选知识库不符'));
    const plan = await call('sync','--dry-run');
    assert.equal(plan.actions,4);
    assert.equal((await instance.call('list',{query:'原稿集成甲'})).total,0);
    assert.equal((await call('sync')).writes,4);
    const [first,second] = await Promise.all(['甲','乙'].map(async key=>
      (await instance.call('list',{query:'原稿集成'+key})).items.find(c=>c.title==='原稿集成'+key)));
    assert.ok(first?.id && second?.id);
    assert.ok((await instance.call('get-document',{id:second.id})).markdown.includes(literal));
    const page = await instance.call('get-document',{id:first.id});
    const probes = await instance.core(`
      const {rawWrite}=await import('./lib/raw-write.mjs');
      const {hash,canonical}=await import('./lib/siyuan.mjs');
      const item={kind:'card',id:input.id};
      const [ordinary,extended]=await rawWrite(api,'raw-probe',{identity:await api.identity(),items:[item,{...item,includeUpdated:true}]});
      const attrs=await api.attrs(input.id),raw=await api.markdown(input.id);
      console.log(JSON.stringify({ordinary,extended,revision:hash(canonical({title:input.title,raw,attrs})),updated:attrs.updated}));
    `,{id:first.id,title:page.title});
    assert.deepEqual(probes.ordinary,{id:first.id,revision:probes.revision});
    assert.match(probes.updated,/^\d{14}$/);
    assert.deepEqual(probes.extended,{...probes.ordinary,updated:probes.updated});
    assert.ok(page.markdown.includes('/cards/'+second.id));
    const path = /\[附件\]\(<?(\/?assets\/[^)>]+)>?\)/.exec(page.markdown)?.[1];
    assert.ok(path);
    const response = await fetch(new URL('/'+path.replace(/^\//,''),instance.url));
    assert.equal(response.status,200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),fileBytes);
    const sourceId = /source=(src_[a-f0-9]+)/.exec(page.markdown)?.[1];
    assert.ok(sourceId);
    assert.equal((await instance.call('source-get',{id:sourceId})).markdown,material);
    const graph = (await (await fetch(instance.url+'/api/graph')).json()).data;
    for (const [s,t] of [[first,second],[second,first]]) {
      assert.ok(graph.edges.some(e=>e.source===s.id && e.target===t.id && e.occurrences.length===1));
    }
    assert.equal((await call('sync')).writes,0);
    mkdirSync(join(b,'assets'));
    renameSync(join(a,'assets/notes.txt'),join(b,'assets/notes.txt'));
    const article = join(a,'article.md');
    writeFileSync(article,readFileSync(article,'utf8').replace('](assets/notes.txt)','](../competing-explanation/assets/notes.txt)'));
    const moved = await call('sync','--dry-run');
    assert.deepEqual(moved.assetMoves,[{from:'方法/scientific-question/assets/notes.txt',to:'方法/competing-explanation/assets/notes.txt'}]);
    assert.deepEqual(moved.missing,[]);
    assert.equal(moved.actions,0);
    assert.equal((await call('sync')).writes,0);
    assert.equal((await instance.call('get-document',{id:first.id})).revision,page.revision);
    appendFileSync(join(b,'article.md'),'\n第二次编辑。\n');
    assert.equal((await call('sync')).writes,1);
    assert.equal((await instance.call('get-document',{id:first.id})).revision,page.revision);
    const remote = await instance.admin('save-document',{op_id:'raw-test-outside-edit',id:first.id,title:page.title,
      markdown:page.markdown+'\n\n库中独立修改。',expected_revision:page.revision});
    await assert.rejects(call('sync','--dry-run'),error => JSON.parse(error.stdout).conflicts.some(c=>c.actualRevision===remote.revision));
    await call('rebase','scientific-question','--revision',remote.revision);
    assert.equal((await call('sync')).writes,1);
    assert.ok(!(await instance.call('get-document',{id:first.id})).markdown.includes('库中独立修改。'));
    assert.equal((await call('sync','--settle')).pending,false);
    instance.record('raw-cli-roundtrip',{cards:2,links:2,assets:1,sources:1,idempotent:true,incremental:true,
      movedAssetWithoutWrite:true,rejectedMountMismatch:true,explicitRevisionRebase:true});
  } finally {writeFileSync(env,bytes);}
}
