import assert from 'node:assert/strict';
import test from 'node:test';
import { CardBodyReader } from '../../lib/card-body-reader.mjs';

test('overlapping reads share two slots and drop cancelled queued batches', { timeout: 2000 }, async () => {
  const began = Promise.withResolvers(), release = Promise.withResolvers(), calls = [];
  let active = 0, peak = 0;
  const reader = new CardBodyReader({
    async markdowns(ids) {
      calls.push(ids);
      peak = Math.max(peak, ++active);
      if (active === 2) began.resolve();
      await release.promise;
      active--;
      return Object.fromEntries(ids.map(id => [id, id]));
    },
  });
  const rows = (prefix, length) => Array.from({ length }, (_, index) => ({ id: prefix + index }));
  const body = (_row, raw) => raw;
  const first = reader.read(rows('first-', 65), {}, body);
  await began.promise;
  const abort = new AbortController();
  const cancelled = reader.read(rows('cancelled-', 70), { signal: abort.signal }, body);
  const other = reader.read(rows('other-', 40), {}, body);
  abort.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  release.resolve();
  assert.deepEqual(await first, rows('first-', 65).map(row => row.id));
  assert.deepEqual(await other, rows('other-', 40).map(row => row.id));
  assert.equal(peak, 2);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(ids => ids.length <= 32 && !ids.some(id => id.startsWith('cancelled-'))));
});

test('bounded derived results use the exact body and evict the least recently reused key', () => {
  const reader = new CardBodyReader({});
  let parses = 0;
  const parse = value => { parses++; return value.trim(); };
  for (let i = 0; i < 1024; i++) reader.derive('tags', 'card-' + i, '原稿', parse);
  reader.derive('tags', 'card-0', '原稿', parse);
  assert.equal(parses, 1024);
  reader.derive('tags', 'new', '原稿', parse);
  reader.derive('tags', 'card-0', '原稿', parse);
  assert.equal(parses, 1025);
  reader.derive('tags', 'card-1', '原稿', parse);
  assert.equal(parses, 1026);
  reader.derive('tags', 'card-1', '原稿 ', parse);
  assert.equal(parses, 1027);
  const another = new CardBodyReader({});
  another.derive('tags', 'card-1', '原稿 ', parse);
  assert.equal(parses, 1028);
});

test('a missing batch entry falls back by ID, and abort during fallback stops later single reads', async () => {
  const rows = ['first', 'second', 'third'].map(id => ({ id }));
  const singles = [];
  const controller = new AbortController();
  const api = {
    async markdowns() { return { third: '', first: '一' }; },
    async markdown(id) { singles.push(id); return '二'; },
  };
  const reader = new CardBodyReader(api);
  assert.deepEqual(await reader.read(rows, {}, (_row, raw) => raw), ['一', '二', '']);
  assert.deepEqual(singles, ['second']);

  api.markdowns = async () => { throw Object.assign(new Error('block not found'), { code: 'siyuan_error' }); };
  api.markdown = async id => {
    singles.push(id);
    controller.abort();
    throw new Error('interrupted');
  };
  await assert.rejects(reader.read(rows, { signal: controller.signal, allowMissing: true }, () => null), { name: 'AbortError' });
  assert.deepEqual(singles, ['second', 'first']);
});
