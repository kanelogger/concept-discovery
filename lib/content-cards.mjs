import { compileRawCard, loadRawTree } from './raw-format.mjs';
import { documentTags, disciplinesFromTags } from './card-list.mjs';
import { headingQuestion } from './wiki.mjs';
import { canonical, hash, normalize } from './siyuan.mjs';
import { compactSummary, readableMarkdown } from './compact.mjs';
import { documentMarkdown } from './documents.mjs';
import { fields } from './knowledge.mjs';
import { readOnlyReason } from './read-commands.mjs';
import { renderCardReferences } from '../server/card-references.mjs';
import { validBlockID } from '../server/render.mjs';

const publicId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const byKey = object => new Map(Object.entries(object));
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const hexDigest = /^[0-9a-f]{64}$/;
const cardLink = id => id === 'new' ? '/?id=new' : '/cards/' + encodeURIComponent(id);

function requireInput(ok, path, reason) {
  if (!ok) throw new Error(path + ': ' + reason);
}

// Validate the supplied local calendar fields without consulting the host timezone.
function validUpdated(value) {
  if (typeof value !== 'string' || !/^\d{14}$/.test(value)) return false;
  const iso = value.slice(0,4) + '-' + value.slice(4,6) + '-' + value.slice(6,8) +
    'T' + value.slice(8,10) + ':' + value.slice(10,12) + ':' + value.slice(12,14) + 'Z';
  const time = Date.parse(iso);
  return Number.isFinite(time) && new Date(time).toISOString() === iso.replace('Z', '.000Z');
}

function documentsOf(tree, metadata, previousIdentities) {
  requireInput(metadata?.version === 1 && isObject(metadata.cards) && isObject(metadata.readings),
    'metadata', '需要版本 1 的 cards 和 readings 清单');
  requireInput(!Object.hasOwn(metadata, 'previousIdentities') &&
    (previousIdentities === undefined || previousIdentities instanceof Map),
    'metadata', '旧版身份须从已校验的发布目录读取');
  const sync = tree.files.has('.sync.json') ? JSON.parse(tree.files.get('.sync.json')) : { version: 1 };
  requireInput(sync?.version === 1 && isObject(sync.cards ?? {}) && isObject(sync.readings ?? {}),
    '.sync.json', '历史身份清单无效');
  const relations = sync.relations ?? [];
  requireInput(Array.isArray(relations) && relations.every(relation =>
    typeof relation?.source_concept_id === 'string' && typeof relation.target_concept_id === 'string'),
  '.sync.json', '历史关系缺少概念身份');
  const cardBindings = byKey(sync.cards ?? {}), readingBindings = byKey(sync.readings ?? {});
  const cardRecords = byKey(metadata.cards), readingRecords = byKey(metadata.readings);
  const keyByNative = new Map([...cardBindings].map(([key, value]) => [value?.remoteId, key]));
  const keyBySlug = new Map();
  for (const [key, value] of cardRecords) {
    if (value?.slug === undefined) continue;
    requireInput(typeof value.slug === 'string' && publicId.test(value.slug) && !keyBySlug.has(value.slug),
      key, '元数据有无效或重复的 slug');
    keyBySlug.set(value.slug, key);
  }
  const docs = new Map(), refs = new Map();

  function register(path, name, record, binding, keys, archived, parentId) {
    requireInput(isObject(record) && typeof record.id === 'string' && publicId.test(record.id),
      path, '缺少有效的稳定公开 ID');
    const { id, updated, aliases = [], blocks = [], revision, legacyFixedFields = false } = record;
    requireInput(validUpdated(updated), path, '需要有效的 14 位北京时间 updated');
    requireInput(Array.isArray(aliases) && Array.isArray(blocks) && typeof legacyFixedFields === 'boolean' &&
      (revision === undefined || (typeof revision === 'string' && revision.length > 0)),
      path, '身份别名、块或修订格式无效');
    requireInput(!binding || binding.remoteId === id, path, '与历史文档公开 ID 不符');
    requireInput(!binding?.archived || archived, path, '历史归档与活动原稿冲突');
    requireInput(archived || ![binding?.legacyMeta, record.legacyMeta].some(meta => meta?.lifecycle_status === 'archived'),
      path, '历史概念归档与活动原稿冲突');
    requireInput(!binding?.parent || binding.parent === parentId, path, '历史补读归属不符');
    requireInput((record.content === undefined && !legacyFixedFields) || isObject(record.content),
      path, '固定字段内容需要冻结的 content 对象');
    requireInput(!record.legacyId || !binding?.legacyId || record.legacyId === binding.legacyId, path, '历史概念身份冲突');
    requireInput(!record.legacyMeta || !binding?.legacyMeta || record.legacyMeta.id === binding.legacyMeta.id,
      path, '历史概念元数据归属冲突');
    const doc = { path, name, id, updated, blocks, revision, legacyFixedFields, archived, parentId, content: record.content,
      requiresFreeze: Boolean(binding || legacyFixedFields || validBlockID(id) || record.legacyMeta || record.legacyId ||
        record.frozenDocument !== undefined || record.frozenGet !== undefined), frozenDocument: record.frozenDocument,
      frozenGet: record.frozenGet,
      legacyMeta: record.legacyMeta ?? binding?.legacyMeta, legacyId: record.legacyId ?? binding?.legacyId };
    function add(ref, anchor = '') {
      requireInput(typeof ref === 'string' && ref.length && ref === ref.trim() && !/[\u0000-\u001f\u007f]/u.test(ref),
        path, '无效的身份别名');
      const previous = refs.get(ref);
      requireInput(!previousIdentities?.has(ref) || previousIdentities.get(ref) === id, path, '身份与旧发布归属不符 ' + ref);
      requireInput(!previous || (previous.doc === doc && previous.anchor === anchor), path, '身份冲突 ' + ref);
      refs.set(ref, { doc, anchor });
    }
    for (const ref of [id, ...keys, ...aliases]) add(ref);
    if (doc.legacyId !== undefined) add(doc.legacyId);
    if (doc.legacyMeta?.id !== undefined) add(doc.legacyMeta.id);
    if (record.frozenGet?.data?.legacyId !== undefined) add(record.frozenGet.data.legacyId);
    const blockIds = new Set();
    for (const block of blocks) {
      requireInput(isObject(block) && validBlockID(block.id) && typeof block.markdown === 'string' &&
        block.markdown.trim() && (block.key === undefined || typeof block.key === 'string'), path, '块身份或原文无效');
      requireInput(!blockIds.has(block.id), path, '重复块 ' + block.id);
      blockIds.add(block.id);
      add(block.id, block.id);
    }
    const frozenBlocks = record.frozenDocument?.data?.blocks ?? [];
    requireInput(Array.isArray(frozenBlocks), path, '冻结文档缺少块列表');
    const nativeIds = record.frozenDocument === undefined ? [] : record.frozenDocument?.blockIds;
    requireInput(Array.isArray(nativeIds) && nativeIds.every(id => typeof id === 'string' && validBlockID(id)) &&
      new Set(nativeIds).size === nativeIds.length, path, '无效或重复的冻结原生块身份');
    for (const id of nativeIds) add(id, id);
    if (record.frozenDocument !== undefined) {
      const inventory = new Set(nativeIds);
      requireInput([...blocks, ...frozenBlocks].every(block => inventory.has(block?.id) && typeof block.markdown === 'string'),
        path, '冻结文档块与原生库存不符');
    }
    for (const [ref, evidence] of Object.entries(binding?.anchors ?? {})) {
      requireInput([...blocks, ...frozenBlocks].some(block => block.id === ref && evidence?.sha256 === hash(block.markdown)),
        path, '历史块缺失或摘要不符 ' + ref);
    }
    docs.set(path, doc);
    return doc;
  }

  for (const card of tree.cards) {
    const rawId = card.id, native = card.metadata.siyuan_id;
    // A directory or slug can be renamed while its original public ID stays fixed.
    const bindingKey = cardBindings.has(rawId) || !native ? rawId : keyByNative.get(native) ?? rawId;
    const binding = cardBindings.get(bindingKey);
    const keys = [...new Set([rawId, native, binding?.remoteId, keyBySlug.get(rawId)])].filter(key => cardRecords.has(key));
    requireInput(keys.length === 1, card.path, keys.length ? '元数据有重复归属' : '缺少卡片元数据');
    const record = cardRecords.get(keys[0]);
    requireInput(isObject(record), card.path, '卡片元数据需要对象');
    requireInput(!native || native === record?.id, card.path, '与 siyuan_id 不符');
    if (record?.id !== rawId && !native && !binding) {
      requireInput(previousIdentities?.get(record?.id) === record?.id &&
        [rawId, ...(Array.isArray(record?.aliases) ? record.aliases : [])].some(ref => previousIdentities?.get(ref) === record.id),
        card.path, '无旧身份的新卡须使用 slug；改名需要旧发布的身份依据');
    }
    requireInput(!record?.slug || record.slug === rawId, card.path, '元数据 slug 所属原稿不符');
    requireInput(keys[0] === rawId || keys[0] === record?.id, card.path, '元数据键与稳定 ID 不符');
    cardRecords.delete(keys[0]);
    cardBindings.delete(bindingKey);
    const status = card.metadata.status;
    requireInput(status === undefined || ['active','archived'].includes(status), card.path, '未知卡片状态');
    const archived = status === 'archived';
    requireInput(record.status === undefined || record.status === (status ?? 'active'), card.path, '元数据与原稿状态冲突');
    requireInput(!card.metadata.archived_at || archived, card.path, '归档时间与卡片状态冲突');
    const primary = register(card.path, card.name, record, binding, [rawId, bindingKey], archived);
    for (const reading of card.readings) {
      register(reading.path, reading.title, readingRecords.get(reading.path), readingBindings.get(reading.path), [], archived, primary.id);
      readingRecords.delete(reading.path);
      readingBindings.delete(reading.path);
    }
  }
  for (const map of [cardRecords, readingRecords, cardBindings, readingBindings])
    if (map.size) throw new Error('身份清单未找到所属原稿 ' + map.keys().next().value);
  for (const doc of docs.values()) {
    if (doc.frozenGet === undefined) continue;
    const {data, sectionOwners} = doc.frozenGet ?? {};
    requireInput(!doc.parentId && isObject(sectionOwners) && Array.isArray(data?.sections), doc.path, '缺少冻结章节或所属文档');
    const seen = new Set();
    for (const section of data.sections) {
      requireInput(isObject(section) && validBlockID(section.id) && !seen.has(section.id), doc.path, '无效或重复的冻结章节');
      const block = refs.get(section.id);
      const owner = block?.doc;
      requireInput(block?.anchor === section.id && owner.id === sectionOwners[section.id] && owner.frozenDocument &&
        (section.key === 'reading' ? owner.parentId === doc.id : owner === doc), doc.path, '冻结章节归属不符 ' + section.id);
      seen.add(section.id);
    }
    requireInput(Object.keys(sectionOwners).length === seen.size, doc.path, '冻结章节归属多出记录');
  }
  for (const [ref, owner] of previousIdentities ?? []) {
    if (refs.has(owner)) requireInput(refs.get(ref)?.doc.id === owner, owner, '缺少旧发布的身份或块 ' + ref);
  }
  return { docs, refs, relations };
}

function documentRefs(refs) {
  return new Map([...refs].map(([ref, { doc }]) => [ref, {
    path: doc.path, name: doc.name, bookmark: '/?id=' + encodeURIComponent(ref),
  }]));
}

export function loadContentTree(rawRoot, metadata, baseline, { previousIdentities } = {}) {
  return loadRawTree(rawRoot, {
    references: true,
    registerReferences(tree) {
      tree.byDocument = documentRefs(documentsOf(tree, metadata, previousIdentities).refs);
      tree.previousIdentities = previousIdentities;
      tree.contentOrigin = metadata.origin ?? 'https://local.invalid';
      tree.historicalSnapshots = new Set((baseline?.sources ?? []).map(source => source.id));
      tree.frozenSourceMetadata = new Map();
      for (const [path, record] of Object.entries(baseline?.sourceFiles ?? {})) {
        if (tree.sourceFiles.has(path) && typeof record?.id === 'string') {
          tree.historicalSnapshots.add(record.id);
          tree.frozenSourceMetadata.set(path, record);
        }
      }
    },
  });
}

function frozenDocument(doc, bytes, origin) {
  const {data, rawSha256, searchText} = doc.frozenDocument ?? {};
  const check = (ok, reason) => requireInput(ok, doc.path, '冻结 get-document ' + reason);
  check(isObject(data) && rawSha256 === hash(bytes), '与当前原稿摘要不符');
  check(data.id === doc.id && data.anchor === undefined && data.title === doc.name &&
    data.revision === doc.revision && hexDigest.test(data.revision) && data.updated === doc.updated, '身份或版本不符');
  check(data.editable === false && data.deletable === false && data.readOnlyReason === readOnlyReason &&
    !data.shareable && !data.canArchive && (data.legacyFixedFields ?? false) === doc.legacyFixedFields, '需要无写入权限的公开读回');
  check(typeof searchText === 'string' && (searchText === doc.name || searchText.startsWith(doc.name + '\n')),
    '缺少当前文档的原生搜索文本');
  check(typeof data.markdown === 'string' && typeof data.html === 'string' && Array.isArray(data.blocks) &&
    new Set(data.blocks.map(block => block.id)).size === data.blocks.length, '正文或块格式无效');
  check(data.url === origin + '/?id=' + doc.id && Array.isArray(data.readings) &&
    same(data.tags, documentTags(data.markdown)) && data.question === headingQuestion(data.markdown), '链接、标签或自测不符');
  const keys = ['id','title','updated','tags','markdown','blocks','revision','editable','deletable','readOnlyReason',
    'legacyFixedFields','readings','url','html','question'];
  check(Object.keys(data).every(key => keys.includes(key)) &&
    data.blocks.every(block => Object.keys(block).every(key => key === 'id' || key === 'markdown')),
    '含不支持的公开字段');
  const args = {id:doc.id, origin, legacyFixedFields:doc.legacyFixedFields};
  // The legacy HTTP reader omits block anchors for documents that its kernel
  // considers uneditable, even when the document exposes snapshot units.
  let render = renderCardReferences(data.markdown, args);
  if (render.html !== data.html) render = renderCardReferences(data.markdown, {...args, blocks:data.blocks});
  check(render.html === data.html, 'HTML 与安全渲染不符');
  return {markdown:data.markdown, ...render, tags:data.tags, question:data.question, blocks:data.blocks, searchText};
}

const legacyMetadata = ['lifecycle_status', 'interaction_type', 'epistemic_type', 'domains', 'intents', 'version', 'created_at', 'updated_at'];

function publicGet(doc, children, origin, relations) {
  const {nativeMarkdown, data} = doc.frozenGet ?? {};
  const check = (ok, reason) => requireInput(ok, doc.path, '冻结 get ' + reason);
  check(isObject(data) && typeof nativeMarkdown === 'string' && hash(nativeMarkdown) === data.hash, '原生正文哈希不符');
  check(data.id === doc.id && data.documentId === doc.id && data.schema === (doc.legacyFixedFields ? 1 : 2) &&
    data.url === origin + '/?id=' + doc.id && (doc.legacyId === undefined || doc.legacyId === data.legacyId), '身份或 schema 不符');
  check(doc.frozenDocument && documentMarkdown(nativeMarkdown) === doc.frozenDocument.data.markdown &&
    readableMarkdown(normalize(nativeMarkdown)) === data.markdown, '两个正文投影不属于同一原生快照');
  check(Array.isArray(data.readings) && data.readings.length === children.length && children.every((child, i) => {
    const item = data.readings[i];
    return child.frozenDocument && item?.id === child.id && item.title === child.name &&
      typeof item.markdown === 'string' && documentMarkdown(item.markdown) === child.frozenDocument.data.markdown &&
      Object.keys(item).every(key => ['id','title','markdown'].includes(key));
  }), '补读顺序、内容、冻结版本或归属不符');
  for (const section of data.sections) {
    const allowed = section.key === 'reading' || (data.schema === 2
      ? ['body','question'].includes(section.key) : fields.includes(section.key));
    check(allowed && typeof section.markdown === 'string' && hash(section.markdown) === section.hash &&
      Object.keys(section).every(key => ['id','key','markdown','hash'].includes(key)), '章节字段或哈希不符 ' + section.id);
  }
  let summary;
  if (data.schema === 1) {
    check(isObject(doc.legacyMeta), '缺少原生固定字段元数据');
    // Schema 1 search and relations use metadata.id. The get command
    // independently prefers the document's custom-cd-legacy-id attribute.
    const relationKey = doc.legacyMeta.id;
    const expected = relations.filter(row => [row.source_concept_id,row.target_concept_id].includes(relationKey));
    const sorted = rows => rows.map(row => JSON.stringify(canonical(row))).sort();
    check(isObject(data.content) && same(data.content, doc.content) &&
      Object.keys(data.content).every(key => fields.includes(key)) && Array.isArray(data.relations) &&
      same(sorted(data.relations), sorted(expected)), '固定字段或关系不符');
    for (const key of legacyMetadata) {
      check(same(data[key], doc.legacyMeta[key]), '历史元数据不符 ' + key);
    }
    summary = {summary:data.content.description ?? '', sources:data.content.source_text ?? ''};
  } else {
    summary = compactSummary(data.markdown);
  }
  check(data.title === (data.content?.name || doc.name) && data.summary === summary.summary && data.sources === summary.sources,
    '标题、摘要或出处不符');
  const keys = ['id','documentId','schema','title','summary','sources','markdown','hash','sections','readings','legacyId',
    ...(data.schema === 1 ? [...legacyMetadata, 'content','relations'] : []), 'url'];
  check(Object.keys(data).every(key => keys.includes(key)), '含不支持的公开字段');
  return data;
}

function renderDocument(doc, markdown, origin, bytes) {
  const base = {id:doc.id, title:doc.name, updated:doc.updated, rawPath:doc.path, requiresFreeze:doc.requiresFreeze};
  const sections = doc.blocks.map(({id, markdown:body, key}) =>
    ({id, key:key ?? (doc.parentId ? 'reading' : 'body'), markdown:body, hash:hash(body)}));
  if (doc.frozenDocument !== undefined) {
    // The portable raw export rewrites links and native layouts. Keep the
    // original document's safe HTML, rendered anchors, and revision together.
    return {...base, ...frozenDocument(doc, bytes, origin), revision:doc.revision, sections, hasFrozenDocument:true};
  }
  // The reader renderer has a fallback for non-visible Markdown tokens. Refuse
  // stale/misordered block evidence before it can attach to unrelated prose.
  let cursor = 0;
  for (const {id, markdown:body} of doc.blocks) {
    const index = markdown.indexOf(body.trim(), cursor);
    requireInput(index >= 0, doc.path, '无法在当前正文中定位块 ' + id);
    cursor = index + body.trim().length;
  }
  const { html, references } = renderCardReferences(markdown, { origin, id: doc.id,
    blocks: doc.blocks, legacyFixedFields: doc.legacyFixedFields });
  for (const block of doc.blocks) requireInput(html.includes('id="' + block.id + '"'), doc.path, '渲染缺少块锚 ' + block.id);
  return { ...base, revision:(doc.requiresFreeze && doc.revision) || hash([doc.name, markdown]),
    markdown, html, blocks:doc.blocks, sections, references, tags:documentTags(markdown), question:headingQuestion(markdown) };
}

export function compileContentCards(tree, metadata, { sourceUrl, assetUrl }) {
  const { docs, refs, relations } = documentsOf(tree, metadata, tree.previousIdentities);
  const origin = metadata.origin ?? 'https://local.invalid';
  const raw = { ...tree, byDocument: documentRefs(refs), contentOrigin: origin };
  const urlFor = doc => doc.archived ? null : cardLink(doc.id);
  const urls = { sourceUrl, assetUrl, cardUrl: slug => urlFor(refs.get(slug).doc),
    readingUrl: path => urlFor(docs.get(path)) };
  const cards = [], readings = [];
  for (const card of tree.cards) {
    const doc = docs.get(card.path);
    if (doc.archived) continue;
    const compiled = compileRawCard(raw, card, urls);
    const body = renderDocument(doc, compiled.markdown, origin, tree.files.get(doc.path));
    const legacyKeys = [doc.legacyId, doc.legacyMeta?.id].filter(Boolean);
    const cardRelations = relations.filter(r => legacyKeys.includes(r.source_concept_id) || legacyKeys.includes(r.target_concept_id));
    const children = compiled.readings.map(reading => docs.get(reading.path));
    if (doc.frozenDocument) {
      const expected = children.map(({id, name}) => ({id, title:name, url:origin + '/?id=' + id}));
      requireInput(same(expected, doc.frozenDocument.data.readings), doc.path, '冻结文档补读顺序、标题或归属不符');
    }
    const updated = compiled.readings.reduce((latest, reading) => {
      const childDate = docs.get(reading.path).updated;
      return childDate > latest ? childDate : latest;
    }, body.updated);
    if (doc.frozenDocument) requireInput(updated === doc.updated, doc.path, '冻结父卡的更新时间早于补读');
    cards.push({ ...body, updated, slug: card.id, url: cardLink(doc.id), description: card.metadata.description ?? '',
      aliases: card.metadata.aliases ?? [], disciplines: disciplinesFromTags(body.tags),
      relations: cardRelations,
      ...(doc.frozenGet !== undefined && {frozenGet: publicGet(doc, children, origin, cardRelations), frozenOrigin:origin}),
      ...(doc.content && { content: doc.content }),
      legacyFixedFields: doc.legacyFixedFields, ...(doc.legacyMeta && { legacyMeta: doc.legacyMeta }),
      ...(doc.legacyId && { legacyId: doc.legacyId }) });
    for (const [position, reading] of compiled.readings.entries()) {
      const child = docs.get(reading.path);
      if (child.frozenDocument) requireInput(same(child.frozenDocument.data.readings, []), child.path, '冻结补读不能含嵌套补读');
      readings.push({ ...renderDocument(child, reading.markdown, origin, tree.files.get(child.path)), parentId: doc.id, position });
    }
  }
  // Imported raw links may name a native block at the right URL but under the
  // wrong parent. Its fragment must actually be owned by that destination.
  for (const doc of [...cards, ...readings]) {
    for (const { ref, fragment } of doc.references) {
      const target = refs.get(ref);
      requireInput(target && !target.doc.archived, doc.rawPath, '引用没有活动归属 ' + ref);
      if (validBlockID(fragment)) {
        const anchor = refs.get(fragment);
        requireInput(anchor?.anchor === fragment && anchor.doc === target.doc, doc.rawPath, '块引用归属不符 ' + fragment);
      }
    }
  }
  const reservedIdentities = [...refs].map(([ref, { doc, anchor }]) => ({ ref, id: doc.id, anchor, ...(doc.parentId && {parentId:doc.parentId}) }))
    .sort((a,b) => compare(a.ref,b.ref));
  const identities = reservedIdentities.filter(({ ref }) => !refs.get(ref).doc.archived);
  return { cards, readings, identities, reservedIdentities };
}
