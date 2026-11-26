import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { documentTags } from '../../lib/card-list.mjs';
import { documentMarkdown } from '../../lib/documents.mjs';
import { readOnlyReason } from '../../lib/read-commands.mjs';
import { canonical, hash, normalize } from '../../lib/siyuan.mjs';
import { headingQuestion } from '../../lib/wiki.mjs';
import { renderCardReferences } from '../../server/card-references.mjs';
import { buildContent, historyInventory } from '../../scripts/build-content.mjs';
import { sourceSnapshot } from '../service/source-fixture.mjs';

const old = '20261101000001-aaaaaaa', reading = '20261101000002-bbbbbbb';
const block = '20261101000003-ccccccc', childBlock = '20261101000004-ddddddd';
const updated = '20261120153000', origin = 'https://old.example', shadow = 'https://shadow.example';
const readingPath = '学科/old/assets/reading.md';
const bookmark = id => origin + '/?id=' + id;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'content-commands-'));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  const raw = join(root, 'raw');
  mkdirSync(join(raw, '学科/old/assets'), {recursive:true});
  mkdirSync(join(raw, '学科/new'), {recursive:true});
  const mainBody = '旧解释。\n\n## 自测\n\n记得吗？\n\n## 标签\n\n方法';
  const nativeLink = '[返回旧卡](/?id=' + old + ')';
  const childBody = '补读独有。\n\n' + nativeLink;
  const readingRaw = '补读独有。\n\n[返回旧卡](../article.md)';
  const article = '---\nname: 旧卡\nsiyuan_id: ' + old +
    '\nreadings: [{title: 附录, path: assets/reading.md}]\n---\n\n## 核心理解\n\n' + mainBody + '\n';
  writeFileSync(join(raw, '学科/old/article.md'), article);
  writeFileSync(join(raw, readingPath), readingRaw);
  writeFileSync(join(raw, '学科/new/article.md'), '---\nname: 新卡\n---\n\n## 核心理解\n\n另一份原稿。');
  const legacyId = 'concept:old';
  const relation = {id:'relation', source_concept_id:'meta:old', target_concept_id:'concept:other'};
  writeFileSync(join(raw, '.sync.json'), JSON.stringify({version:1, identity:'fixture',
    cards:{old:{remoteId:old, legacyId, legacyMeta:{id:'meta:old', version:3}}}, readings:{}, relations:[relation]}));

  const native = mainBody + '\n{: id="' + old + '" updated="' + updated + '"}';
  const section = {id:block,key:'description',markdown:'旧解释。'};
  section.hash = hash(section.markdown);
  const readingSection = {id:childBlock,key:'reading',markdown:nativeLink,hash:hash(nativeLink)};
  const content = {name:'卡片字段名称',description:'冻结的字段摘要',source_text:'冻结出处'};
  const oldGet = {id:old,documentId:old,legacyId,schema:1,title:content.name,summary:content.description,
    sources:content.source_text,hash:hash(native),markdown:normalize(native),content,
    sections:[section,readingSection],readings:[{id:reading,title:'附录',markdown:childBody}],
    version:3,relations:[relation],url:bookmark(old)};
  function record({id,title,md,rawText,blocks,readings = [],fixed = false}) {
    const markdown = documentMarkdown(md), revision = hash([title,md]);
    const data = {id,title,updated,markdown,blocks,revision,readings,url:bookmark(id),tags:documentTags(markdown),
      question:headingQuestion(markdown),editable:false,deletable:false,readOnlyReason,
      ...(fixed && {legacyFixedFields:true}),
      html:renderCardReferences(markdown,{origin,id,blocks,legacyFixedFields:fixed}).html};
    return {id,updated,revision,frozenDocument:{rawSha256:hash(rawText),data,blockIds:blocks.map(b=>b.id),
      searchText:[title,markdown,...(fixed ? ['仅原生索引字段'] : [])].join('\n')}};
  }
  const main = record({id:old,title:'旧卡',md:native,rawText:article,
    blocks:[{id:block,markdown:section.markdown}],fixed:true,readings:[{id:reading,title:'附录',url:bookmark(reading)}]});
  Object.assign(main, {content, legacyFixedFields:true,frozenGet:{nativeMarkdown:native,data:oldGet,
    sectionOwners:{[block]:old,[childBlock]:reading}}});
  const child = record({id:reading,title:'附录',md:childBody,rawText:readingRaw,blocks:[{id:childBlock,markdown:nativeLink}]});
  child.blocks = [{id:childBlock,markdown:nativeLink}];
  const source = sourceSnapshot('test', {title:'原文',markdown:'字😀'});
  const createdAt = source.createdAt;
  const proposal = {id:'prop_1111111111111111',kind:'proposal',createdAt,updatedAt:createdAt};
  const audit = {...proposal,id:'prop_2222222222222222',kind:'audit'};
  for (const row of [audit,proposal]) row.revision = hash(canonical(row));
  const event = {id:'evt_1111111111111111',kind:'review',createdAt};
  const baseline = {version:1,libraryId:'fixture',sources:[source],proposals:[proposal,audit],events:[event]};
  const metadata = {version:1,libraryId:'fixture',origin,cards:{[old]:main,new:{id:'new',updated:'20261121153000'}},
    readings:{[readingPath]:child},history:historyInventory(baseline)};
  function build({output = join(root,'release'), previous, resealManifest} = {}) {
    const metadataFile = join(root,'metadata.json'), baselineFile = join(root,'history.json');
    writeFileSync(metadataFile,JSON.stringify(metadata));
    writeFileSync(baselineFile,JSON.stringify(baseline));
    buildContent({rawRoot:raw,metadataFile,baselineFile,output,previous,resealManifest});
    return join(output,'knowledge.sqlite');
  }
  return {root,raw,article,readingRaw,metadata,baseline,main,child,oldGet,source,proposal,audit,event,build};
}

export { fixture, old, reading, block, childBlock, readingPath, updated, origin, shadow };
