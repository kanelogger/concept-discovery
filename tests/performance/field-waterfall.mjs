// Opaque resource identifiers and classification keep public reports independent of titles,
// card IDs, URLs, query strings, headers and private response content.
export function routeClass(raw, origin, type) {
  let url;
  try { url = new URL(raw); } catch { return 'other'; }
  if (!['http:', 'https:'].includes(url.protocol)) return 'non-http';
  if (url.origin !== origin) return 'external';
  const path = url.pathname;
  if (path === '/api/session') return 'session';
  const command = /^\/api\/v1\/commands\/(list|search|get|get-document|sources-list|source-get|wiki-card|wiki-proposals|wiki-proposal|wiki-events)$/.exec(path);
  if (command) return 'command-' + command[1];
  if (path === '/api/graph' || path === '/api/scenarios') return 'api-' + path.slice(5);
  if (path.startsWith('/api/')) return 'other-api';
  if (path === '/login') return 'login';
  if ((path === '/' && url.searchParams.has('id')) || /^\/cards\/[^/]+(?:\/edit)?$/.test(path)) return 'card';
  if (['/', '/cards'].includes(path)) return 'cards';
  if (['/wiki', '/scenarios', '/graph', '/archives'].includes(path)) return path.slice(1);
  if (path === '/share' || path.startsWith('/share/')) return 'share';
  if (type === 'Script' || path.startsWith('/ui/') && path.endsWith('.js')) return 'script';
  if (type === 'Stylesheet' || path.endsWith('.css')) return 'style';
  if (type === 'Image' || path === '/favicon.svg') return 'image';
  if (type === 'Font') return 'font';
  return 'other';
}

const ms = value => Math.round(value * 10) / 10;
// Protocol error strings can include private addresses; report only known categories.
const networkFailures = new Map([
  ['ERR_CERT_AUTHORITY_INVALID', 'tls-error'], ['ERR_CERT_COMMON_NAME_INVALID', 'tls-error'],
  ['ERR_CERT_DATE_INVALID', 'tls-error'], ['ERR_CERT_INVALID', 'tls-error'],
  ['ERR_SSL_PROTOCOL_ERROR', 'tls-error'], ['ERR_SSL_VERSION_OR_CIPHER_MISMATCH', 'tls-error'],
  ['ERR_CONNECTION_CLOSED', 'connection-closed'], ['ERR_EMPTY_RESPONSE', 'connection-closed'],
  ['ERR_CONNECTION_RESET', 'connection-reset'], ['ERR_CONNECTION_REFUSED', 'connection-refused'],
  ['ERR_CONNECTION_TIMED_OUT', 'connection-timeout'], ['ERR_TIMED_OUT', 'connection-timeout'],
  ['ERR_CONNECTION_ABORTED', 'connection-aborted'], ['ERR_NAME_NOT_RESOLVED', 'name-resolution-error'],
]);
export function networkFailure(raw) {
  const code = /^(?:page\.goto: )?net::(ERR_[A-Z0-9_]+)(?:\s|$)/.exec(raw)?.[1];
  return networkFailures.get(code) ?? 'network-error';
}
function span(start, end) {
  return start >= 0 && end >= start ? ms(end - start) : null;
}
function attachResponse(row, response) {
  const t = response.timing;
  const headers = Object.entries(response.headers ?? {});
  const coding = headers.find(([name]) => name.toLowerCase() === 'content-encoding')?.[1]?.toLowerCase();
  row.emptyRedirect = headers.some(([name, value]) => name.toLowerCase() === 'content-length' && value === '0');
  Object.assign(row, {
    status: response.status,
    encoding: coding ? ['br', 'gzip', 'deflate', 'zstd'].includes(coding) ? coding : 'other' : 'identity',
    reused: response.fromDiskCache || response.fromServiceWorker || row.cache === 'http' ? null : response.connectionReused,
  });
  if (response.fromServiceWorker) row.cache = 'service-worker';
  else if (response.fromDiskCache) row.cache = 'http';
  if (t) {
    row.firstByte = t.receiveHeadersStart >= 0 ? t.requestTime + t.receiveHeadersStart / 1000 : null;
    row.dnsMs = span(t.dnsStart, t.dnsEnd);
    // CDP connectEnd includes TLS. Split the phases so they can be compared individually.
    row.tcpMs = span(t.connectStart, t.sslStart >= 0 ? t.sslStart : t.connectEnd);
    row.tlsMs = span(t.sslStart, t.sslEnd);
    row.waitHeadersMs = span(t.sendEnd, t.receiveHeadersStart);
  }
}

export async function observeNetwork(session, origin) {
  const rows = [], current = new Map(), extra = new Map();
  session.on('Network.requestWillBeSent', event => {
    if (event.redirectResponse) {
      const old = current.get(event.requestId);
      if (old) {
        attachResponse(old, event.redirectResponse);
        Object.assign(old, { end: event.timestamp, redirect: true, expectsExtra: event.redirectHasExtraInfo,
          wireBytes: event.redirectResponse.encodedDataLength });
      }
    }
    const route = routeClass(event.request.url, origin, event.type);
    if (route === 'non-http') return current.delete(event.requestId);
    const row = { id: event.requestId, url: event.request.url, type: event.type, route, start: event.timestamp,
      cache: 'network', wireBytes: null, status: null, end: null };
    rows.push(row);
    current.set(row.id, row);
  });
  session.on('Network.requestServedFromCache', ({ requestId }) => {
    const row = current.get(requestId);
    if (row) row.cache = 'http';
  });
  session.on('Network.responseReceivedExtraInfo', ({ requestId, statusCode }) => {
    if (!extra.has(requestId)) extra.set(requestId, []);
    extra.get(requestId).push(statusCode);
  });
  session.on('Network.responseReceived', ({ requestId, response, hasExtraInfo }) => {
    const row = current.get(requestId);
    if (row) {
      attachResponse(row, response);
      row.expectsExtra = hasExtraInfo;
    }
  });
  session.on('Network.loadingFinished', ({ requestId, timestamp, encodedDataLength }) => {
    const row = current.get(requestId);
    if (row) Object.assign(row, { end: timestamp, wireBytes: encodedDataLength });
  });
  session.on('Network.loadingFailed', ({ requestId, timestamp, canceled, errorText }) => {
    const row = current.get(requestId);
    if (row) Object.assign(row, { end: timestamp, failure: canceled ? 'canceled' : networkFailure(errorText) });
  });
  await session.send('Network.enable', { maxPostDataSize: 0 });
  return function waterfall(navStart, entries) {
    // Match completed Resource Timing records, including POST and the main document.
    // Full names are transient matching keys. Neither URLs nor raw protocol values leave this function.
    const byURL = new Map();
    for (const entry of entries) {
      if (!byURL.has(entry.name)) byURL.set(entry.name, []);
      byURL.get(entry.name).push(entry);
    }
    return rows.map(row => {
      const status = row.expectsExtra && extra.get(row.id)?.shift() || row.status;
      const startMs = ms((row.start - navStart) * 1000);
      const endMs = row.end === null ? null : ms((row.end - navStart) * 1000);
      let entry;
      if (!row.redirect && row.end !== null) {
        const candidates = byURL.get(row.url.split('#')[0]);
        if (candidates?.length) {
          // Same URL can have parallel requests. Use completion time, identical across both clocks.
          const closest = candidates.reduce((best, item, i) =>
            Math.abs(item.end - endMs) < Math.abs(candidates[best].end - endMs) ? i : best, 0);
          entry = candidates.splice(closest, 1)[0];
        }
      }
      const cache = status === 304 ? 'revalidated' : row.cache;
      let encodedBodyBytes = null;
      if (cache === 'http' || cache === 'revalidated' || status === 204) encodedBodyBytes = 0;
      else if (entry && row.route !== 'external' && cache === 'network' && !row.failure) encodedBodyBytes = entry.body;
      else if (row.redirect && row.emptyRedirect) encodedBodyBytes = 0;
      return { route: row.route, kind: row.type, startMs, endMs, status, cache,
        connectionReused: cache === 'network' || cache === 'revalidated' ? row.reused ?? null : null,
        firstByteMs: row.firstByte == null ? null : ms((row.firstByte - navStart) * 1000),
        dnsMs: row.dnsMs ?? null, tcpMs: row.tcpMs ?? null, tlsMs: row.tlsMs ?? null,
        waitHeadersMs: row.waitHeadersMs ?? null, encoding: row.encoding ?? null,
        encodedBodyBytes, wireBytes: row.wireBytes, failure: row.failure ?? (status >= 400 ? 'http-error' : null) };
    }).sort((a, b) => a.startMs - b.startMs);
  };
}

export function atReadable(waterfall, cutoff) {
  if (cutoff === null) return null;
  const started = waterfall.filter(row => row.startMs <= cutoff);
  const finished = started.filter(row => row.endMs !== null && row.endMs <= cutoff);
  const budgets = rows => {
    const done = rows.filter(row => finished.includes(row) && row.encodedBodyBytes !== null);
    const knownBytes = done.reduce((sum, row) => sum + row.encodedBodyBytes, 0);
    return { knownBytes, unknownRequests: rows.length - done.length,
      totalBytes: rows.length === done.length ? knownBytes : null };
  };
  const business = finished.filter(row => row.route.startsWith('command-') || row.route.startsWith('api-'));
  return { cutoffMs: cutoff, bodies: budgets(started), jsCss: budgets(started.filter(row => ['script', 'style'].includes(row.route) || ['Script', 'Stylesheet'].includes(row.kind))),
    lastBusinessEndToReadableMs: business.length ? ms(cutoff - Math.max(...business.map(row => row.endMs))) : null };
}
