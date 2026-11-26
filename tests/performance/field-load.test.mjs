import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { authHTTPSFixture } from '../service/auth-https-fixture.mjs';
import { launchMeasurementBrowser, runPairs } from './field-load.mjs';

test('five real cold/warm pairs classify cache, validation, documents and failure without leaking request data', async () => {
  const secret = 'private-data-never-in-report';
  const js = gzipSync('/*' + secret.repeat(20) + '*/');
  const counts = { script: 0, validation: 0, document: 0 };
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/ui/asset.js') {
      counts.script++;
      res.writeHead(200, { 'Cache-Control': 'max-age=86400', 'Content-Type': 'text/javascript',
        'Content-Encoding': 'gzip', 'Content-Length': js.length }).end(js);
    } else if (path === '/ui/asset.css') {
      if (req.headers['if-none-match']) {
        counts.validation++;
        res.writeHead(304).end();
      } else res.writeHead(200, { 'Cache-Control':'no-cache', ETag:'"one"', 'Content-Type':'text/css' }).end('h1{color:black}');
    } else if (path === '/location') {
      res.writeHead(302, { 'Cache-Control': 'no-store', 'Content-Length':'0', Location: '/content?' + secret }).end();
    } else if (path === '/content') {
      counts.document++;
      res.writeHead(200, { 'Content-Type':'text/html', 'Cache-Control':'no-store', 'X-Private-Header':secret }).end(
        '<link rel="stylesheet" href="/ui/asset.css"><script src="/ui/asset.js?' + secret + '"></script>' +
        '<script>fetch("/api/' + secret + '")</script><h1>' + secret + '</h1>');
    } else if (path === '/disconnect') req.socket.destroy();
    else if (path === '/late') res.writeHead(200, { 'Content-Type':'text/html' }).end('<p>waiting</p>');
    else res.writeHead(404).end(secret);
  });
  await new Promise((yes, no) => server.once('error', no).listen(0, '127.0.0.1', yes));
  const directURL = 'http://127.0.0.1:' + server.address().port;
  let browser, tlsFixture, otherTLS;
  try {
    tlsFixture = await authHTTPSFixture({ through: async () => ({ port: server.address().port, close: async () => {} }) });
    browser = await launchMeasurementBrowser(tlsFixture);
    const settings = { target: new URL('/location#' + secret, tlsFixture.url), readProgramRequests: tlsFixture.programRequests,
      view: 'custom', selector: 'h1', count: 1, timeout: 2_000 };
    const report = await runPairs(browser, settings);
    assert.equal(counts.script, 5);
    assert.equal(counts.document, 10);
    assert.equal(counts.validation, 5);
    assert.equal(report.samples.length, 10);
    for (const sample of report.samples) {
      assert.equal(sample.failure, null);
      assert.ok(sample.fcpMs > 0 && sample.readableMs >= sample.fcpMs);
      assert.equal(sample.atReadable.cutoffMs, sample.readableMs);
      const accounted = sample.waterfall.filter(row => row.startMs <= sample.readableMs &&
        row.endMs != null && row.endMs <= sample.readableMs && row.encodedBodyBytes != null);
      assert.equal(sample.atReadable.bodies.knownBytes, accounted.reduce((sum, row) => sum + row.encodedBodyBytes, 0));
      const redirect = sample.waterfall.find(row => row.status === 302);
      assert.equal(redirect.encodedBodyBytes, 0);
      const script = sample.waterfall.find(row => row.kind === 'Script');
      const cold = sample.visit === 'cold';
      assert.equal(sample.fixtureServerProgramRequests, cold ? 2 : 1); // CSS revalidates on every revisit.
      assert.equal(script.cache, cold ? 'network' : 'http');
      assert.equal(script.encodedBodyBytes, cold ? js.length : 0);
      const css = sample.waterfall.find(row => row.kind === 'Stylesheet');
      assert.equal(css.cache, cold ? 'network' : 'revalidated');
      assert.equal(css.status, cold ? 200 : 304);
      assert.equal(css.encodedBodyBytes, cold ? 15 : 0);
      assert.ok(sample.waterfall.some(row => row.route === 'other-api' && row.failure === 'http-error'));
    }
    const serialized = JSON.stringify(report);
    for (const prohibited of [secret, '127.0.0.1', '/location', '/content', '/asset.', 'X-Private-Header']) {
      assert.ok(!serialized.includes(prohibited));
    }
    const failed = await runPairs(browser, { ...settings, target: new URL('/missing', settings.target) });
    assert.equal(failed.summary.cold.succeeded, 0);
    assert.equal(failed.summary.revisit.succeeded, 0);
    assert.ok(failed.samples.every(s => s.failure === 'document-http-error' && s.readableMs === null));
    const late = await runPairs(browser, { ...settings, target: new URL('/late', settings.target), timeout: 300 });
    assert.ok(late.samples.every(s => s.failure === 'readability-timeout' && s.readableMs === null));
    const disconnected = await runPairs(browser, { ...settings, target: new URL('/disconnect', directURL) });
    assert.ok(disconnected.samples.every(s => ['connection-closed', 'connection-reset'].includes(s.failure)));
    const tls = await runPairs(browser, { ...settings, target: new URL(directURL.replace(/^http:/, 'https:')) });
    assert.ok(tls.samples.every(s => s.failure === 'tls-error'));
    otherTLS = await authHTTPSFixture();
    const tab = await browser.newPage();
    await assert.rejects(tab.goto(otherTLS.url + '/login'), /ERR_CERT_AUTHORITY_INVALID/);
  } finally {
    try { await browser?.close(); }
    finally {
      await otherTLS?.close();
      await tlsFixture?.close();
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    }
  }
});
