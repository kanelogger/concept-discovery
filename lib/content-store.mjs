import { DatabaseSync } from 'node:sqlite';
import { parseFragment } from 'parse5';
import { compactSummary } from './compact.mjs';
import { listOptions } from './card-list.mjs';
import { splitQuery } from './library-scope.mjs';
import { readOnlyReason } from './read-commands.mjs';

const formatVersion = 1;
const blockTags = new Set(['p','li','h1','h2','h3','h4','h5','h6','td','th','pre','br','div']);

// Boundaries separate fields, while inline emphasis and links remain searchable as ordinary prose.
function visibleText(html) {
  const portions = [];
  function visit(node) {
    const boundary = blockTags.has(node.tagName);
    if (boundary) portions.push('\n');
    if (node.nodeName === '#text') portions.push(node.value);
    if (node.tagName === 'img') portions.push(node.attrs.find(attr => attr.name === 'alt')?.value ?? '');
    for (const child of node.childNodes ?? []) visit(child);
    if (boundary) portions.push('\n');
  }
  visit(parseFragment(html));
  return portions.join('');
}

export function writeContentDatabase(path, {cards, readings, identities, materials, views, inventoryDigest}) {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      PRAGMA foreign_keys = ON;
      BEGIN;
      PRAGMA user_version = ${formatVersion};
      CREATE TABLE release_metadata(inventory_digest TEXT NOT NULL) STRICT;
      CREATE TABLE documents(id TEXT PRIMARY KEY, parent TEXT REFERENCES documents(id), position INTEGER,
        title TEXT NOT NULL, updated TEXT NOT NULL, payload TEXT NOT NULL) STRICT;
      CREATE INDEX list_order ON documents(updated DESC,id DESC) WHERE parent IS NULL;
      CREATE INDEX reading_order ON documents(parent,position) WHERE parent IS NOT NULL;
      CREATE TABLE identities(ref TEXT PRIMARY KEY, id TEXT NOT NULL REFERENCES documents(id), anchor TEXT NOT NULL) STRICT;
      CREATE TABLE tags(id TEXT REFERENCES documents(id), tag TEXT, PRIMARY KEY(id,tag)) WITHOUT ROWID;
      CREATE INDEX tag_cards ON tags(tag,id);
      CREATE VIRTUAL TABLE search_text USING fts5(owner UNINDEXED, document UNINDEXED, text, tokenize='trigram');
      CREATE TABLE records(kind TEXT, id TEXT, payload TEXT NOT NULL, PRIMARY KEY(kind,id)) WITHOUT ROWID;
      CREATE TABLE assets(path TEXT PRIMARY KEY, filename TEXT NOT NULL, hash TEXT NOT NULL, mime TEXT NOT NULL,
        size INTEGER NOT NULL, legacy_path TEXT, owners TEXT NOT NULL) STRICT;
      CREATE INDEX asset_names ON assets(filename);
      CREATE INDEX legacy_asset_names ON assets(legacy_path);
      CREATE TABLE views(name TEXT PRIMARY KEY, payload TEXT NOT NULL) STRICT;
    `);
    db.prepare('INSERT INTO release_metadata VALUES (?)').run(inventoryDigest);
    const document = db.prepare('INSERT INTO documents VALUES (?,?,?,?,?,?)');
    const search = db.prepare('INSERT INTO search_text(owner,document,text) VALUES (?,?,?)');
    const tag = db.prepare('INSERT INTO tags VALUES (?,?)');
    for (const row of [...cards, ...readings]) {
      const searchSummary = row.legacyFixedFields
        ? {summary:row.content.description ?? '',sources:row.content.source_text ?? ''}
        : compactSummary(row.markdown);
      document.run(row.id, row.parentId ?? null, row.position ?? null, row.title, row.updated, JSON.stringify({...row,searchSummary}));
      search.run(row.parentId ?? row.id, row.id, [row.title, ...(row.aliases ?? []), visibleText(row.html)].join('\n'));
      if (!row.parentId) for (const name of row.tags) tag.run(row.id, name);
    }
    const identity = db.prepare('INSERT INTO identities VALUES (?,?,?)');
    for (const {ref,id,anchor} of identities) identity.run(ref,id,anchor ?? '');
    const record = db.prepare('INSERT INTO records VALUES (?,?,?)');
    for (const kind of ['sources','proposals','events']) {
      for (const value of materials[kind]) record.run(kind,value.id,JSON.stringify(value));
    }
    const asset = db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?,?)');
    for (const item of materials.assets) {
      asset.run(item.path,item.filename,item.hash,item.mime,item.bytes.length,item.legacyPath ?? null,JSON.stringify(item.owners));
    }
    const view = db.prepare('INSERT INTO views VALUES (?,?)');
    for (const [name,value] of Object.entries(views)) view.run(name,JSON.stringify(value));
    db.exec("INSERT INTO search_text(search_text) VALUES ('integrity-check')");
    if (db.prepare('PRAGMA foreign_key_check').get() || db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') {
      throw new Error('内容库完整性检查失败');
    }
    db.exec('COMMIT');
  } finally {
    db.close();
  }
}

function fail(code, message) { throw Object.assign(new Error(message), {code}); }

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
    if (db.prepare('PRAGMA user_version').get().user_version !== formatVersion) throw new Error('内容库版本不匹配');
    db.exec('PRAGMA query_only = ON');
    const lookup = db.prepare('SELECT d.payload,d.parent,i.anchor FROM identities i JOIN documents d USING(id) WHERE ref=?');
    const children = db.prepare('SELECT id,title FROM documents WHERE parent=? ORDER BY position,id');
    const archive = db.prepare('SELECT payload FROM records WHERE kind=? AND id=?');
    const asset = db.prepare("SELECT filename,hash,mime,size FROM assets WHERE filename=? OR legacy_path=? LIMIT 1");
    const precomputed = db.prepare('SELECT payload FROM views WHERE name=?');
    const link = (id,origin) => origin + '/?id=' + encodeURIComponent(id);
    function document(ref,origin = '') {
      const result = lookup.get(ref);
      if (!result) fail('not_found','找不到文档');
      const d = JSON.parse(result.payload);
      return {id:d.id,title:d.title,updated:d.updated,...(result.anchor && {anchor:result.anchor}),markdown:d.markdown,html:d.html,
        tags:d.tags ?? [],blocks:(d.blocks ?? []).map(({id,markdown})=>({id,markdown})),revision:d.revision,question:d.question ?? '',editable:false,deletable:false,readOnlyReason,
        ...(d.legacyFixedFields && {legacyFixedFields:true}),url:link(d.id,origin),
        readings:children.all(d.id).map(r => ({...r,url:link(r.id,origin)}))};
    }
    function list(input = {}) {
      const {offset,limit,query,tag,updatedFrom,updatedTo,includeTags} = listOptions(input);
      const clauses = ['parent IS NULL'], args = [];
      const hits = matches(query);
      if (hits.sql) { clauses.push('id IN (SELECT owner FROM (' + hits.sql + '))'); args.push(...hits.args); }
      if (updatedFrom) { clauses.push('updated >= ?'); args.push(updatedFrom.replaceAll('-','')+'000000'); }
      if (updatedTo) { clauses.push('updated <= ?'); args.push(updatedTo.replaceAll('-','')+'235959'); }
      const base = ' FROM documents WHERE ' + clauses.join(' AND ');
      if ((includeTags===true || tag) && db.prepare('SELECT count(*) AS n'+base).get(...args).n>10000)
        fail('invalid_input','Narrow the filters before loading tags');
      const scope = base + (tag ? ' AND id IN (SELECT id FROM tags WHERE tag=?)' : '');
      const filtered = tag ? [...args,tag] : args;
      const total = db.prepare('SELECT count(*) AS n'+scope).get(...filtered).n;
      const withTags = includeTags || tag;
      const columns = "id,title,updated,'' AS summary" + (withTags ? ",json_extract(payload,'$.tags') AS tags" : '');
      const items = db.prepare('SELECT '+columns+scope+' ORDER BY updated DESC,id DESC LIMIT ? OFFSET ?').all(...filtered,limit,offset)
        .map(r => withTags ? {...r,tags:JSON.parse(r.tags)} : {...r});
      const page = {items,offset,limit,total,hasMore:offset+items.length<total};
      if ((includeTags === true || tag) && includeTags !== 'page') {
        page.tags = db.prepare('SELECT DISTINCT tag FROM tags WHERE id IN (SELECT id'+base+')').all(...args)
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
      return db.prepare('SELECT d.payload FROM ('+hits.sql+') h JOIN documents d ON d.id=h.owner GROUP BY h.owner ORDER BY min(h.document),h.owner LIMIT ?')
        .all(...hits.args,limit).map(({payload})=>{
          const d=JSON.parse(payload);
          return {id:d.id,name:d.content?.name ?? d.title,summary:d.searchSummary.summary.slice(0,400),sources:d.searchSummary.sources,
            ...(d.legacyId && {legacyId:d.legacyId}),url:link(d.id,origin)};
        });
    }
    function record(kind,id) {
      const result=archive.get(kind,id);
      if (!result) fail('not_found','找不到归档记录');
      return JSON.parse(result.payload);
    }
    return {list,search,document,record,close:()=>db.close(),
      inventoryDigest:db.prepare('SELECT inventory_digest FROM release_metadata').get().inventory_digest,
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
