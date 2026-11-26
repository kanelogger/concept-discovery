// node tests/performance/field-load.mjs --help
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { routeClass, observeNetwork, atReadable, networkFailure } from './field-waterfall.mjs';

const help = `node tests/performance/field-load.mjs --fixture
node tests/performance/field-load.mjs --url https://HOST/cards --view login
node tests/performance/field-load.mjs --url https://HOST/cards --view cards --owner-login
node tests/performance/field-load.mjs --url-stdin --view custom --selector CSS [--count N] [--owner-login]
Views: login, cards (20 titles), card, graph, scenarios, wiki, custom.
--url-stdin reads the private address from stdin through EOF. Supply only a URL; use the dedicated browser for login.
The default fixture logs in a synthetic owner over HTTPS and renders 20 fixed list items. It measures no kernel query.
Use --fixture --view login for the anonymous form or --fixture --view card for an authenticated document.
JSON to stdout; failed samples are included and set a nonzero exit code. Five cold/new-tab pairs.
Readable time and byte cutoff use the later of the target-content frame and FCP. Duration values in ms. Null bytes mean incomplete observation (see unknownRequests).
wireBytes is Chromium's transfer count including protocol overhead; encodedBodyBytes excludes headers and local cache hits.
scriptTaskMsAtProbe is Chromium's cumulative ScriptDuration as sampled after the readable frame; it includes measurement overhead.
LCP is the last candidate in a fixed 500 ms observation window after the readable probe. Public summary omits raw addresses and response content.`;
const views = {
  login: '#login-password', cards: '.card-title-link', card: '#document-body .prose',
  graph: '.graph-node', scenarios: '.atlas-entries, .atlas-empty', wiki: '.wiki-source-choice, .wiki-page .ant-empty',
  custom: null,
};
const round = value => Math.round(value * 10) / 10;
const viewport = { width: 1440, height: 900 };

// Executed in the document. Record the second frame with the requested content present,
// including at least one rendered on-screen match. Never inspect titles or text.
function installProbe({ selector, count }) {
  if (window !== top) return;
  window.fieldProbe = { readableMs: null, lcpMs: null, invalidSelector: false };
  performance.setResourceTimingBufferSize(4000);
  const seen = entries => {
    for (const entry of entries) window.fieldProbe.lcpMs = entry.startTime;
  };
  const lcpObserver = new PerformanceObserver(list => seen(list.getEntries()));
  lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
  let matched = false;
  function frame() {
    let nodes;
    try { nodes = document.querySelectorAll(selector); }
    catch { window.fieldProbe.invalidSelector = true; return; }
    const visible = nodes.length >= count && Array.from(nodes).some(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth &&
        el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    });
    if (matched && visible) window.fieldProbe.readableMs = performance.now();
    else { matched = visible; requestAnimationFrame(frame); }
  }
  requestAnimationFrame(frame);
}
function readPaints() {
  const nav = performance.getEntriesByType('navigation')[0];
  const entries = [nav, ...performance.getEntriesByType('resource')].filter(Boolean)
    .map(e => ({ name: e.name.split('#')[0], body: e.encodedBodySize, end: e.responseEnd }));
  // Navigation Timing includes the initial address for some redirect chains.
  if (entries.length && nav) entries[0].name = location.href.split('#')[0];
  return { entries, readableMs: window.fieldProbe?.readableMs ?? null, lcpMs: window.fieldProbe?.lcpMs ?? null,
    fcpMs: performance.getEntriesByName('first-contentful-paint', 'paint')[0]?.startTime ?? null,
    observedUntilMs: performance.now() };
}

async function takeSample(context, settings) {
  const { target, view, selector, count, timeout } = settings;
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  try {
    const getWaterfall = await observeNetwork(session, target.origin);
    await session.send('Performance.enable');
    await page.addInitScript(installProbe, { selector, count });
    let committed = false, failure = null, scriptTaskMsAtProbe = null;
    try {
      const response = await page.goto(target.href, { waitUntil: 'commit', timeout });
      committed = true;
      const landing = new URL(page.url());
      if (!response?.ok()) failure = 'document-http-error';
      else if (landing.origin !== target.origin) failure = 'different-origin';
      else if (view !== 'login' && landing.pathname === '/login') failure = 'login-required';
      if (!failure) {
        await page.waitForFunction(() => window.fieldProbe?.invalidSelector ||
          window.fieldProbe?.readableMs != null && performance.getEntriesByName('first-contentful-paint', 'paint').length > 0,
          undefined, { timeout });
        const { metrics } = await session.send('Performance.getMetrics');
        const script = metrics.find(metric => metric.name === 'ScriptDuration');
        if (script) scriptTaskMsAtProbe = round(script.value * 1000);
        if (await page.evaluate(() => window.fieldProbe.invalidSelector)) failure = 'invalid-selector';
        else await new Promise(resolve => setTimeout(resolve, 500)); // One fixed post-readability window for LCP delivery.
      }
    } catch (error) {
      if (committed) failure = error.name === 'TimeoutError' ? 'readability-timeout' : 'probe-error';
      else failure = error.name === 'TimeoutError' ? 'navigation-timeout' : networkFailure(error.message);
    }
    const landedURL = new URL(page.url());
    const sameOrigin = landedURL.origin === target.origin;
    const paints = sameOrigin ? await page.evaluate(readPaints).catch(() => ({})) : {};
    const { metrics } = await session.send('Performance.getMetrics');
    const navStart = metrics.find(item => item.name === 'NavigationStart')?.value;
    const waterfall = getWaterfall(navStart, paints.entries ?? []);
    const readableMs = paints.readableMs == null || paints.fcpMs == null ? null : round(Math.max(paints.readableMs, paints.fcpMs));
    if (!failure && settings.syntheticOwner && view === 'cards') {
      const completed = waterfall.filter(row => row.status === 200 && row.endMs != null && row.endMs <= readableMs);
      if (!['session', 'command-list'].every(route => completed.some(row => row.route === route))) failure = 'fixture-reads-missing';
    }
    const landed = routeClass(landedURL.href, target.origin, 'Document');
    const expectedRoute = view === 'custom' ? landed !== 'login' : view === landed;
    if (!failure && (readableMs === null || !sameOrigin || !expectedRoute)) failure = 'unexpected-page';
    const sample = { failure, landed, readableMs: failure ? null : readableMs,
      fcpMs: paints.fcpMs == null ? null : round(paints.fcpMs),
      lcpMs: paints.lcpMs == null ? null : round(paints.lcpMs),
      observedUntilMs: paints.observedUntilMs == null ? null : round(paints.observedUntilMs),
      scriptTaskMsAtProbe, waterfall };
    sample.atReadable = atReadable(waterfall, sample.readableMs);
    return sample;
  } finally { await page.close(); }
}

async function loginCookie(browser, settings, contextOptions) {
  const context = await browser.newContext(contextOptions);
  try {
    const page = await context.newPage();
    await page.goto(new URL('/login', settings.target.origin).href);
    const accepted = page.waitForResponse(r => {
      const url = new URL(r.url());
      return url.origin === settings.target.origin && url.pathname === '/api/session/login' && r.status() === 200;
    }, { timeout: 300_000 });
    if (settings.syntheticOwner) {
      const fillForm = async () => {
        await page.locator('#login-username').fill(settings.syntheticOwner.username);
        await page.locator('#login-password').fill(settings.syntheticOwner.password);
        await page.locator('.session-form button[type=submit]').click();
      };
      await Promise.all([accepted, fillForm()]);
    } else {
      process.stderr.write('请在专用浏览器窗口完成站主登录。\n');
      await accepted;
    }
    await page.waitForURL(url => url.origin === settings.target.origin && url.pathname !== '/login');
    const cookie = (await context.cookies(settings.target.origin)).find(c =>
      c.name === '__Host-cd-session' && c.domain === settings.target.hostname && c.path === '/' && c.httpOnly && c.secure);
    if (!cookie) throw Error();
    return cookie;
  } finally { await context.close(); }
}

function summarize(samples) {
  const success = samples.filter(item => !item.failure);
  const eligible = success.filter(item => item.pairedColdSucceeded !== false);
  const stats = values => {
    const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
    const n = ordered.length;
    return n ? { n, min: ordered[0], median: round((ordered[Math.floor((n-1)/2)] + ordered[Math.floor(n/2)])/2),
      max: ordered[n-1] } : null;
  };
  return { attempts: samples.length, succeeded: success.length, eligible: eligible.length,
    readableMs: stats(eligible.map(x => x.readableMs)), fcpMs: stats(eligible.map(x => x.fcpMs)), lcpMs: stats(eligible.map(x => x.lcpMs)),
    encodedBodyBytes: stats(eligible.map(x => x.atReadable.bodies.totalBytes)), jsCssBytes: stats(eligible.map(x => x.atReadable.jsCss.totalBytes)) };
}

export async function runPairs(browser, settings) {
  const contextOptions = { viewport };
  let cookie;
  if (settings.ownerLogin) {
    // Only the interactive sign-in needs a visible window. All samples use the same
    // measurement browser/mode, irrespective of the audience being measured.
    const loginBrowser = await chromium.launch({ headless: false });
    try { cookie = await loginCookie(loginBrowser, settings, contextOptions); }
    finally { await loginBrowser.close(); }
  } else if (settings.syntheticOwner) cookie = await loginCookie(browser, settings, contextOptions);
  const samples = [];
  for (let pair = 1; pair <= 5; pair++) {
    const context = await browser.newContext(contextOptions);
    try {
      if (cookie) await context.addCookies([cookie]);
      // Closing the first tab retains this context's HTTP cache and connection pool.
      // No routing, cache toggle, reload or persistent user profile participates.
      let coldSucceeded = false;
      for (const visit of ['cold', 'revisit']) {
        const serverStart = settings.readProgramRequests?.();
        const sample = await takeSample(context, settings).catch(() => ({ failure: 'probe-error', waterfall: [] }));
        if (serverStart !== undefined) sample.fixtureServerProgramRequests = settings.readProgramRequests() - serverStart;
        if (visit === 'cold') coldSucceeded = !sample.failure;
        else sample.pairedColdSucceeded = coldSucceeded;
        samples.push({ pair, visit, ...sample });
      }
    } finally { await context.close(); }
  }
  const source = !settings.fixture ? 'field' : settings.view === 'graph' ? 'synthetic-local-sql' : 'synthetic-https-fixed-data';
  return { schema: 2, source, ...(settings.readProgramRequests ? { fixtureTLS: 'temporary-spki-pin' } : {}),
    browser: browser.version(), viewport,
    targetRoute: routeClass(settings.target.href, settings.target.origin, 'Document'), view: settings.view,
    expectedCount: settings.count, session: cookie ? 'dedicated-owner' : 'fresh-context',
    summary: Object.fromEntries(['cold','revisit'].map(visit => [visit, summarize(samples.filter(s => s.visit === visit))])), samples };
}

// A certificate-error exception via DevTools prevents normal cache writes in Chromium.
export function launchMeasurementBrowser(httpsFixture) {
  if (!httpsFixture) return chromium.launch();
  // This isolated process accepts only the newly generated fixture key in addition to normal trust.
  return chromium.launch({ args: ['--ignore-certificate-errors-spki-list=' + httpsFixture.publicKeyPin] });
}

async function main() {
  const { values } = parseArgs({ options: { url: { type:'string' }, 'url-stdin': { type:'boolean' },
    view: { type:'string' }, fixture: { type:'boolean' }, 'owner-login': { type:'boolean' },
    selector: { type:'string' }, count: { type:'string' }, help: { type:'boolean' } } });
  if (values.help) { console.log(help); return; }
  if ([values.fixture, Boolean(values.url), values['url-stdin']].filter(Boolean).length !== 1) throw Error();
  const view = values.view ?? (values.fixture ? 'cards' : null);
  const ownerLogin = Boolean(values['owner-login']);
  if (!Object.hasOwn(views, view) || ownerLogin && (values.fixture || view === 'login')) throw Error();
  if (values.fixture && !['login', 'card', 'cards', 'graph'].includes(view)) throw Error();
  const selector = values.selector ?? views[view];
  const count = values.count === undefined ? view === 'cards' ? 20 : 1 : Number(values.count);
  if (!selector || !Number.isSafeInteger(count) || count < 1) throw Error();
  async function run(raw, httpsFixture, syntheticOwner) {
    const target = new URL(raw);
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password ||
        ownerLogin && target.protocol !== 'https:') throw Error();
    const selected = !values.selector && view === 'wiki' && target.searchParams.has('source') ? '.wiki-source-text' : selector;
    const browser = await launchMeasurementBrowser(httpsFixture);
    try {
      const report = await runPairs(browser, { target, view, selector: selected, count, timeout: 30_000,
        fixture: Boolean(values.fixture), readProgramRequests: httpsFixture?.programRequests, syntheticOwner, ownerLogin });
      console.log(JSON.stringify(report, null, 2));
      if (report.samples.some(sample => sample.failure)) process.exitCode = 1;
    } finally { await browser.close(); }
  }
  if (values.fixture) {
    execFileSync(process.execPath, [fileURLToPath(new URL('../../scripts/build-web.mjs', import.meta.url))], { stdio: 'pipe' });
    if (view !== 'graph') {
      const { authHTTPSFixture, owner, card } = await import('../service/auth-https-fixture.mjs');
      const listItems = Array.from({ length: 20 }, (_, i) => ({
        id: '20261123000000-' + i.toString(36).padStart(7, '0'), title: '合成卡 ' + (i + 1),
        tags: ['学科' + (i % 5 + 1)], updated: '20261123080000',
      }));
      const service = await authHTTPSFixture({ listItems });
      try {
        const path = view === 'card' ? '/cards/' + card.id : '/cards';
        await run(service.url + path, service, view === 'login' ? undefined : owner);
      } finally { await service.close(); }
    } else {
      const { withCardFixture } = await import('./card-fixture.mjs');
      await withCardFixture({ root: resolve('.'), size: 300 }, url => run(url + '/' + view));
    }
  } else {
    let raw = values.url;
    if (values['url-stdin']) {
      raw = '';
      for await (const chunk of process.stdin) raw += chunk;
    }
    await run(raw.trim());
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    // Playwright errors often contain full addresses, selectors and response previews.
    process.stderr.write('测量未能启动或完成。请核对 --help、浏览器启动和连接条件。\n');
    process.exitCode = 1;
  });
}
