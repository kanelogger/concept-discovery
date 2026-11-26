import { DatabaseSync } from 'node:sqlite';
import { parseFragment } from 'parse5';
import { compactSummary } from './compact.mjs';
import { contentFormatVersion } from './content-reader-store.mjs';

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
      PRAGMA user_version = ${contentFormatVersion};
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
      const published = row.frozenGet ?? row.authoredGet;
      const searchSummary = published ? {summary:published.summary,sources:published.sources} : row.legacyFixedFields
        ? {summary:row.content.description ?? '',sources:row.content.source_text ?? ''}
        : compactSummary(row.markdown);
      const {searchText, ...payload} = row;
      document.run(row.id, row.parentId ?? null, row.position ?? null, row.title, row.updated, JSON.stringify({...payload,searchSummary}));
      // The old reader queries the kernel's block content. Its index can contain
      // text omitted by the public renderer, particularly for fixed-field cards.
      search.run(row.parentId ?? row.id, row.id, searchText ?? [row.title, ...(row.aliases ?? []), visibleText(row.html)].join('\n'));
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
