import { DatabaseSync } from 'node:sqlite';
import { readOnlyReason } from './read-commands.mjs';
import { canonical, hash, fail, listOptions, splitQuery } from './read-contract.mjs';

export function inventoryDigest({libraryId,history,reservedIdentities,authoredDocuments}) {
  return hash(canonical({libraryId,history,reservedIdentities,authoredDocuments}));
}

export const contentFormatVersion = 2;

function publicLinks(value, frozenOrigin, currentOrigin) {
  if (Array.isArray(value)) return value.map(item => publicLinks(item, frozenOrigin, currentOrigin));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key,entry]) => [key,
    key === 'url' && typeof entry === 'string' && entry.startsWith(frozenOrigin + '/')
      ? currentOrigin + entry.slice(frozenOrigin.length) : publicLinks(entry, frozenOrigin, currentOrigin),
  ]));
}

// FTS5 finds long substrings. Recheck with SQLite's literal ASCII-case-insensitive comparison
// to match the legacy search, including punctuation; trigram cannot index one or two characters.
function matches(query) {
  const terms = [...new Set(splitQuery(query))];
  if (terms.some(term => term.includes('\0'))) fail('invalid_input','关键词含有无效字符');
  const short = terms.filter(term => [...term].length < 3);
  const long = terms.filter(term => [...term].length >= 3);
  const branches = [], args = [];
  const literal = 'EXISTS (SELECT 1 FROM json_each(?) q WHERE instr(lower(s.text), lower(q.value)) > 0)';
  if (long.length) {
    branches.push('SELECT owner,document FROM search_text s WHERE s.rowid IN (SELECT rowid FROM search_text WHERE search_text MATCH ?) AND ' + literal);
    args.push(long.map(term => '"' + term.replaceAll('"','""') + '"').join(' OR '),JSON.stringify(long));
  }
  if (short.length) {
    branches.push('SELECT owner,document FROM search_text s WHERE ' + literal);
    args.push(JSON.stringify(short));
  }
  return {sql:branches.join(' UNION ALL '),args};
}

export function openContentStore(path) {
  const db = new DatabaseSync(path,{readOnly:true});
  try {
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (![1,contentFormatVersion].includes(version)) throw new Error('内容库版本不匹配');
    db.exec('PRAGMA query_only = ON');
    const lookup = db.prepare('SELECT d.payload,d.parent,i.anchor FROM identities i JOIN documents d USING(id) WHERE ref=?');
    const children = db.prepare('SELECT id,title FROM documents WHERE parent=? ORDER BY position,id');
    const childPayloads = db.prepare('SELECT payload FROM documents WHERE parent=? ORDER BY position,id');
    const main = db.prepare(`SELECT d.id,d.title,json_extract(d.payload,'$.slug') AS rawId
      FROM identities i JOIN documents d USING(id) WHERE i.ref=? AND i.anchor='' AND d.parent IS NULL`);
    const archive = db.prepare('SELECT payload FROM records WHERE kind=? AND id=?');
    const asset = db.prepare("SELECT filename,hash,mime,size FROM assets WHERE filename=? OR legacy_path=? LIMIT 1");
    const precomputed = db.prepare('SELECT payload FROM views WHERE name=?');
    const link = (id,origin) => origin + '/?id=' + encodeURIComponent(id);
    function activeMain(ref) {
      const row = typeof ref === 'string' && main.get(ref);
      return row ? {...row} : null;
    }
    function card(ref, origin = '') {
      if (!activeMain(ref)) fail('identity_conflict','Concept missing or identity duplicated');
      const d = JSON.parse(lookup.get(ref).payload);
      const url = link(d.id, origin);
      if (d.frozenGet) return {...publicLinks(d.frozenGet, d.frozenOrigin, origin), url};
      if (d.authoredGet) return {...publicLinks(d.authoredGet, d.frozenOrigin, origin), url};
      if (d.requiresFreeze || version !== contentFormatVersion) fail('configuration','既有卡缺少冻结的 get 投影');
      const readings = childPayloads.all(d.id).map(r => JSON.parse(r.payload));
      return {id:d.id, documentId:d.id, schema:2, ...(d.legacyId && {legacyId:d.legacyId}), title:d.title, ...d.searchSummary, markdown:d.markdown,
        hash:hash(d.markdown), readings:readings.map(({id,title,markdown}) => ({id,title,markdown})),
        sections:[...d.sections, ...readings.flatMap(r => r.sections)], url};
    }
    function document(ref,origin = '') {
      const result = lookup.get(ref);
      if (!result) fail('not_found','找不到文档');
      const d = JSON.parse(result.payload);
      return {id:d.id,title:d.title,updated:d.updated,...(result.anchor && {anchor:result.anchor}),markdown:d.markdown,html:d.html,
        tags:d.tags ?? [],blocks:(d.blocks ?? []).map(({id,markdown})=>({id,markdown})),revision:d.revision,question:d.question ?? '',editable:false,deletable:false,readOnlyReason,
        ...(d.legacyFixedFields && {legacyFixedFields:true}),url:link(d.id,origin),
        readings:children.all(d.id).map(r => ({...r,url:link(r.id,origin)}))};
    }
    // List and search SQL vary only with the optional filter clauses and the
    // short/long FTS branches. All user input, including terms, stays bound.
    const statements = new Map();
    function statement(sql) {
      const cached = statements.get(sql);
      if (cached) return cached;
      const prepared = db.prepare(sql);
      if (statements.size < 128) statements.set(sql, prepared);
      return prepared;
    }
    function list(input = {}) {
      const {offset,limit,query,tag,updatedFrom,updatedTo,includeTags} = listOptions(input);
      const clauses = ['parent IS NULL'], args = [];
      const hits = matches(query);
      if (hits.sql) { clauses.push('id IN (SELECT owner FROM (' + hits.sql + '))'); args.push(...hits.args); }
      if (updatedFrom) { clauses.push('updated >= ?'); args.push(updatedFrom.replaceAll('-','')+'000000'); }
      if (updatedTo) { clauses.push('updated <= ?'); args.push(updatedTo.replaceAll('-','')+'235959'); }
      const base = ' FROM documents WHERE ' + clauses.join(' AND ');
      if ((includeTags===true || tag) && statement('SELECT count(*) AS n'+base).get(...args).n>10000)
        fail('invalid_input','Narrow the filters before loading tags');
      const scope = base + (tag ? ' AND id IN (SELECT id FROM tags WHERE tag=?)' : '');
      const filtered = tag ? [...args,tag] : args;
      const total = statement('SELECT count(*) AS n'+scope).get(...filtered).n;
      const withTags = includeTags || tag;
      const columns = "id,title,updated,'' AS summary" + (withTags ? ",json_extract(payload,'$.tags') AS tags" : '');
      const items = statement('SELECT '+columns+scope+' ORDER BY updated DESC,id DESC LIMIT ? OFFSET ?').all(...filtered,limit,offset)
        .map(r => withTags ? {...r,tags:JSON.parse(r.tags)} : {...r});
      const page = {items,offset,limit,total,hasMore:offset+items.length<total};
      if ((includeTags === true || tag) && includeTags !== 'page') {
        page.tags = statement('SELECT DISTINCT tag FROM tags WHERE id IN (SELECT id'+base+')').all(...args)
          .map(r=>r.tag).sort((a,b)=>a.localeCompare(b,'zh-CN'));
      }
      return page;
    }
    function search(input = {},origin = '') {
      if (!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(k=>!['query','limit'].includes(k))) fail('invalid_input','Invalid search fields');
      const {query='',limit=5} = input;
      if (typeof query!=='string' || query.length>1000 || !Number.isInteger(limit) || limit<1 || limit>20) fail('invalid_input','Invalid search');
      const hits = matches(query);
      if (!hits.sql) return [];
      return statement('SELECT d.payload FROM ('+hits.sql+') h JOIN documents d ON d.id=h.owner GROUP BY h.owner ORDER BY min(h.document),h.owner LIMIT ?')
        .all(...hits.args,limit).map(({payload})=>{
          const d=JSON.parse(payload);
          const legacyId = d.legacyFixedFields ? d.legacyMeta?.id : d.frozenGet?.legacyId ?? d.legacyId;
          return {id:d.id,name:d.legacyFixedFields ? d.content.name ?? '' : d.title,summary:d.searchSummary.summary.slice(0,400),sources:d.searchSummary.sources,
            ...(legacyId && {legacyId}),url:link(d.id,origin)};
        });
    }
    function record(kind,id) {
      const result=archive.get(kind,id);
      if (!result) fail('not_found','资料或提案不存在。');
      return JSON.parse(result.payload);
    }
    function records(kind) {
      const rows = statement('SELECT payload FROM records WHERE kind=?').all(kind).map(r => JSON.parse(r.payload));
      if (kind === 'sources') return rows.sort((a,b) => b.createdAt.localeCompare(a.createdAt) || b.version-a.version || a.id.localeCompare(b.id));
      if (kind === 'proposals') return rows.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
      return rows.sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    }
    function assertCommandReady() {
      if (version !== contentFormatVersion) fail('configuration','影子服务需要版本 2 的内容库，旧包只用于离线核对');
      const missing = db.prepare(`SELECT id FROM documents WHERE json_type(payload,'$.requiresFreeze') IS NULL
        OR (json_extract(payload,'$.requiresFreeze') AND
          (NOT coalesce(json_extract(payload,'$.hasFrozenDocument'),0) OR
          (parent IS NULL AND json_type(payload,'$.frozenGet') IS NULL))) LIMIT 1`).get();
      if (missing) fail('configuration','影子服务缺少完整冻结的公开投影：' + missing.id);
    }
    return {list,search,card,document,record,records,activeMain,assertCommandReady,close:()=>db.close(),
      inventoryDigest:db.prepare('SELECT inventory_digest FROM release_metadata').get().inventory_digest,
      nativeEvidence(id) {
        const row = lookup.get(id);
        if (!row || row.anchor) return null;
        const d = JSON.parse(row.payload);
        if (d.id!==id || !d.requiresFreeze || !d.hasFrozenDocument) return null;
        return {sha256:d.nativeFreezeSha256,shape:d.inputShape,blocks:d.sections.map(({id,markdown})=>({id,markdown}))};
      },
      publicInventory() {
        return {
          activeIds:db.prepare('SELECT id FROM documents WHERE parent IS NULL ORDER BY id').all().map(row=>row.id),
          publicRefs:db.prepare('SELECT ref FROM identities ORDER BY ref').all().map(row=>row.ref),
        };
      },
      assetManifest() {
        return db.prepare('SELECT DISTINCT filename,hash,size FROM assets ORDER BY filename').all().map(row => ({...row}));
      },
      asset(path) {
        if (typeof path!=='string' || !path.startsWith('/assets/')) return null;
        const result=asset.get(path.slice('/assets/'.length),path.slice(1));
        return result ? {...result} : null;
      },
      view(name) {
        const result=precomputed.get(name);
        if (!result) fail('not_found','找不到预计算视图');
        return JSON.parse(result.payload);
      }};
  } catch (error) {
    db.close();
    throw error;
  }
}
