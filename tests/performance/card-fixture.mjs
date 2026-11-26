import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const docId = i => '20261123000000-' + i.toString(36).padStart(7, '0');

// The SQL, application/Web routes and browser assets are from the measured checkout.
// Only the kernel transport and the intermediate detail page's data are synthetic.
function fixture(size) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE blocks(id TEXT PRIMARY KEY,root_id,box,path,type,content,updated); CREATE INDEX roots ON blocks(root_id); CREATE TABLE attributes(block_id,name,value); CREATE INDEX attrs ON attributes(block_id)');
  const add = db.prepare('INSERT INTO blocks VALUES(?,?,?,?,?,?,?)');
  const documents = new Map();
  for (let i = 0; i < size; i++) {
    const id = docId(i);
    add.run(id, id, 'fixture', '/root/' + id + '.sy', 'd', '合成卡 ' + i, '20261123010000');
    const target = i > 0 && i % 7 === 0 ? 0 : (i + 7) % size;
    documents.set(id, ['## 标签', '学科：分类' + i % 6, '## 理解', '用同一组合成卡对照列表和图谱。'.repeat(35),
      '[相邻卡](/cards/' + docId((i + 1) % size) + ') 和 [关联卡](/cards/' + docId(target) + ')'].join('\n\n'));
  }
  const stats = { requests: 0, documents: 0, bytes: 0 };
  async function read(ids, { signal } = {}) {
    stats.requests++;
    stats.documents += ids.length;
    await delay(2, undefined, { signal });
    const data = Object.fromEntries(ids.map(id => [id, documents.get(id)]));
    for (const value of Object.values(data)) stats.bytes += Buffer.byteLength(value);
    return data;
  }
  return { db, stats, api: {
    c: { notebookId: 'fixture', libraryRootId: 'root' },
    identity: async () => 'fixture',
    sql: async stmt => db.prepare(stmt).all(),
    markdowns: read,
    markdown: async (id, options) => (await read([id], options))[id],
  } };
}
export async function withCardFixture({ root, size }, run) {
  const reservation = createServer();
  await new Promise((yes, no) => reservation.once('error', no).listen(0, '127.0.0.1', yes));
  const { port } = reservation.address();
  await new Promise(yes => reservation.close(yes));
  const url = 'http://127.0.0.1:' + port;
  const { createApp } = await import(pathToFileURL(resolve(root, 'server/app.mjs')));
  const { db, api, stats } = fixture(size);
  const app = createApp({ authMode: 'local', api, agentToken: 'synthetic', publicUrl: url });
  try {
    await new Promise((yes, no) => app.once('error', no).listen(port, '127.0.0.1', yes));
    return await run(url, stats);
  } finally {
    const closed = new Promise(yes => app.close(yes));
    app.closeAllConnections();
    await closed;
    db.close();
  }
}
