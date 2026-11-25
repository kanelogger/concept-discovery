import assert from 'node:assert/strict';
import test from 'node:test';
import { orderedReadings, orderRawReadings, readingOrderAttr } from '../../lib/raw-reading-order.mjs';

const parent = '20260101000000-abcdef0';
const a = '20260101000001-abcdef1', b = '20260101000002-abcdef2', c = '20260101000003-abcdef3';
const rows = [a, b, c].map(id => ({ id, path: '/' + parent + '/' + id + '.sy' }));

test('legacy reading IDs stay sorted and unlisted children follow the explicit list', () => {
  assert.deepEqual(orderedReadings(rows.toReversed(), undefined), rows);
  assert.deepEqual(orderedReadings(rows, JSON.stringify([c, a])).map(r => r.id), [c, a, b]);
});

test('lost reply resumes the fixed parent attribute write, keeping other readings in order', async () => {
  const attrs = { [readingOrderAttr]: JSON.stringify([c, b, a]) };
  let revision = 'old', writes = 0;
  const receipt = {};
  const api = {
    c: { notebookId: 'test' },
    async operate(_command, _input, action) { return action(receipt, () => {}); },
    async sql() { return rows; },
    async flush() {},
    async setAttrs(_id, values) {
      writes++;
      Object.assign(attrs, values);
      revision = 'new';
      throw Object.assign(new Error('lost reply'), { code: 'transport_unknown' });
    },
  };
  const documents = { async snapshot() { return { id: parent, title: '父', attrs, nodes: [], revision }; } };
  const input = { identity: 'test', id: parent, expected_revision: 'old', readings: [b], op_id: 'order' };
  await assert.rejects(orderRawReadings(api, documents, input), { code: 'transport_unknown' });
  const result = await orderRawReadings(api, documents, input);
  assert.deepEqual(result, { id: parent, revision: 'new' });
  assert.deepEqual(JSON.parse(attrs[readingOrderAttr]), [b, c, a]);
  assert.equal(writes, 1);
  assert.equal(receipt.beforeOrder, JSON.stringify([c, b, a]));
});

test('ordering checks membership and parent revision before any mutation', async () => {
  const api = { c: { notebookId: 'test' }, async operate(_command, _input, action) { return action({}, () => {}); }, async sql() { return rows; } };
  const documents = { async snapshot() { return { id: parent, title: '父', attrs: {}, nodes: [], revision: 'v1' }; } };
  const input = { identity: 'test', id: parent, expected_revision: 'v0', readings: [b] };
  await assert.rejects(orderRawReadings(api, documents, input), { code: 'content_conflict' });
  await assert.rejects(orderRawReadings(api, documents, { ...input, readings: ['20260101000000-zzzzzzz'] }), { code: 'outside_scope' });
  await assert.rejects(orderRawReadings(api, documents, { ...input, readings: [b, b] }), { code: 'invalid_input' });
});
