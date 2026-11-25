// Run against a built checkout: node tests/performance/cards-graph.mjs [root] [size] [samples]
import assert from 'node:assert/strict';
import { Session } from 'node:inspector/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(process.argv[2] || '.');
const size = Number(process.argv[3] || 300);
const samples = Number(process.argv[4] || 5);
assert.ok(Number.isSafeInteger(size) && size >= 20 && Number.isSafeInteger(samples) && samples > 0);
const { createApp } = await import(pathToFileURL(resolve(root, 'server/app.mjs')));
const docId = i => '20261123000000-' + i.toString(36).padStart(7, '0');

// The SQL, application/Web routes and browser assets are from the measured checkout.
// Only the kernel transport and the intermediate detail page's data are synthetic.
function fixture() {
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
async function withApp(run) {
  const reservation = createServer();
  await new Promise((yes, no) => reservation.once('error', no).listen(0, '127.0.0.1', yes));
  const { port } = reservation.address();
  await new Promise(yes => reservation.close(yes));
  const url = 'http://127.0.0.1:' + port;
  const { db, api, stats } = fixture();
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

function observeContent({ selector, expected }) {
  window.measureContent = (start = performance.now()) => {
    window.contentTime = null;
    // Observe the route through the first painted frame containing the full page.
    const observer = new MutationObserver(() => {
      if (document.querySelectorAll(selector).length !== expected) return;
      if (selector === '.card-title-link' &&
          !document.querySelector('.ant-pagination:not(.ant-pagination-disabled)')) return;
      observer.disconnect();
      requestAnimationFrame(() => requestAnimationFrame(() => { window.contentTime = performance.now() - start; }));
    });
    observer.observe(document, { childList: true, attributes: true, subtree: true });
  };
  window.measureContent(0);
}
async function measure(browser, route) {
  return withApp(async (url, stats) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const graph = route === 'graph';
      const selector = graph ? '.graph-node' : '.card-title-link';
      const endpoint = graph ? '/api/graph' : '/api/v1/commands/list';
      await context.addInitScript(observeContent, { selector, expected: graph ? size : 20 });
      const page = await context.newPage();
      // Opening a detail uses the actual UI route; its request is outside either measured interval.
      await page.route('**/api/v1/commands/get-document', request => {
        const { id } = request.request().postDataJSON();
        return request.fulfill({ json: { ok: true, data: { id, title: '合成详情', html: '<p>合成详情</p>', markdown: '合成详情' } } });
      });
      await page.goto(url + '/' + route);
      await page.waitForFunction(() => window.contentTime !== null);
      const cold = await page.evaluate(() => window.contentTime);
      const coldReads = { ...stats };
      const assets = await page.evaluate(() => performance.getEntriesByType('resource')
        .filter(entry => new URL(entry.name).pathname.endsWith('.js')).reduce((size, entry) => size + entry.decodedBodySize, 0));
      if (graph) {
        await page.locator(selector).first().press('Enter');
        await page.locator('#graph-open-card').evaluate(el => el.click());
      } else await page.locator(selector).first().evaluate(el => el.click());
      await page.locator('#reader').waitFor();
      const refreshed = page.waitForResponse(response => response.url() === url + endpoint);
      await page.locator('#back-to-list').evaluate(button => { window.measureContent(); button.click(); });
      await page.waitForFunction(() => window.contentTime !== null);
      const revisit = await page.evaluate(() => window.contentTime);
      assert.equal((await refreshed).status(), 200);
      return { cold, revisit, assets, coldReads, revisitRequests: stats.requests - coldReads.requests };
    } finally { await context.close(); }
  });
}

// Collect function counts in a separate run so coverage instrumentation never affects timings.
async function parseCounts(route) {
  return withApp(async url => {
    const session = new Session();
    session.connect();
    try {
      await session.post('Profiler.enable');
      await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: false });
      const counts = [];
      for (let i = 0; i < 2; i++) {
        const response = route === 'graph' ? await fetch(url + '/api/graph') :
          await fetch(url + '/api/v1/commands/list', { method: 'POST', headers: { origin: url, 'content-type': 'application/json' },
            body: JSON.stringify({ limit: 20, includeTags: true }) });
        assert.equal(response.status, 200);
        await response.json();
        const { result } = await session.post('Profiler.takePreciseCoverage');
        const module = result.find(entry => entry.url === pathToFileURL(resolve(root, 'lib/card-list.mjs')).href);
        counts.push(module?.functions.find(fn => fn.functionName === 'tagsFromNodes')?.ranges[0].count ?? 0);
      }
      assert.ok(counts[0] > 0, 'tag parser must be observed on the cold read');
      return counts;
    } finally { session.disconnect(); }
  });
}
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round((sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2);
};
const browser = await chromium.launch();
try {
  for (const route of ['cards', 'graph']) {
    const measurements = [];
    for (let i = 0; i < samples; i++) measurements.push(await measure(browser, route));
    console.log(JSON.stringify({ route, size, samples, browser: browser.version(), coldMs: median(measurements.map(x => x.cold)),
      revisitMs: median(measurements.map(x => x.revisit)), jsBytes: measurements[0].assets, coldBodyReads: measurements[0].coldReads,
      revisitRequests: measurements[0].revisitRequests, fullInventoryParses: await parseCounts(route),
      timings: measurements.map(({ cold, revisit }) => [Math.round(cold), Math.round(revisit)]) }));
  }
} finally { await browser.close(); }
