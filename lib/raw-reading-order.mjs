import { matchesWriteWitness } from "./document-receipt.mjs";
import { canonical, fail, hash, quote } from './siyuan.mjs';
import { readingIds } from './library-scope.mjs';

export const readingOrderAttr = 'custom-cd-reading-order';
const blockId = /^\d{14}-[a-z0-9]{7}$/;

export function orderedReadings(rows, serialized) {
  let ids;
  try { ids = JSON.parse(serialized ?? '[]'); } catch { ids = []; }
  const order = new Map((Array.isArray(ids) ? ids : []).map((id, index) => [id, index]));
  return [...rows].sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export async function readOrderedReadings(api, parent, attrs, { requireComplete = false } = {}) {
  const rows = await api.sql(`SELECT d.id,d.content,d.path FROM blocks b JOIN blocks d ON d.id IN (${readingIds()})
    WHERE b.id=${quote(parent)} AND b.box=${quote(api.c.notebookId)} ORDER BY d.id LIMIT 1001`);
  if (requireComplete && rows.length > 1000) fail('unsupported_structure', '每张卡最多支持 1000 份补充阅读。');
  return orderedReadings(rows, attrs?.[readingOrderAttr]).slice(0, 1000);
}

const nodeGuard = snapshot => hash(canonical({
  title: snapshot.title,
  attrs: Object.fromEntries(Object.entries(snapshot.attrs).filter(([key]) => key !== 'updated' && key !== readingOrderAttr)),
  nodes: snapshot.nodes.map(({ id, type, parent, raw, attrs }) => ({ id, type, parent, raw, attrs })),
}));

async function expectedRevision(api, input, card) {
  if (input.expected_operation) {
    const { value } = await api.receipt(input.expected_operation);
    if (!value || value.target !== input.identity || value.state !== 'verified' || value.result?.id !== input.id ||
        !['save-document', 'raw-create-document', 'raw-convert-document'].includes(value.command))
      fail('content_conflict', '无法从同一父卡的已核实文档回执取得版本。');
    if (value.command === 'raw-create-document' && value.createdSignature !== card.signature)
      fail('content_conflict', '父卡与创建时的原生块签名不符。');
    if (value.command !== 'raw-create-document' && !matchesWriteWitness(value, card))
      fail('content_conflict', '父卡与原写入版本或原生块签名不符。');
    return value.result.revision;
  }
  return input.expected_revision;
}

export async function orderRawReadings(api, documents, input) {
  const { id, readings } = input;
  if (!blockId.test(id) || !Array.isArray(readings) || readings.length > 1000 ||
      !readings.every(value => blockId.test(value) && value !== id) || new Set(readings).size !== readings.length ||
      Boolean(input.expected_revision) === Boolean(input.expected_operation))
    fail('invalid_input', '补充阅读顺序、父卡或版本无效。');
  return api.operate('raw-order-readings', input, async (rec, persist) => {
    const snapshot = async () => {
      const card = await documents.snapshot(id);
      if (card.id !== id || card.attrs['custom-cd-parent'] || card.attrs['custom-cd-kind'] === 'article')
        fail('outside_scope', '只能为当前知识库中的父卡设置补充阅读顺序。');
      const rows = await readOrderedReadings(api, id, card.attrs, { requireComplete: true });
      const members = new Set(rows.map(r => r.id));
      if (rows.some(r => !r.path.endsWith('/' + id + '/' + r.id + '.sy')) || readings.some(reading => !members.has(reading)))
        fail('outside_scope', '补充阅读不在指定父卡下。');
      return { card, ids: rows.map(r => r.id), membership: [...members].sort() };
    };
    const current = await snapshot();
    const confirm = ({ card, ids, membership }) => {
      if (card.attrs[readingOrderAttr] !== rec.intended || JSON.stringify(ids) !== rec.intended ||
          JSON.stringify(membership) !== rec.membership || nodeGuard(card) !== rec.guard)
        fail('readback_conflict', '补充阅读顺序、父卡或成员发生变化。');
      rec.afterOrderSignature = card.signature;
      persist();
      return { id, revision: card.revision };
    };
    if (rec.intended && current.card.attrs[readingOrderAttr] === rec.intended) return confirm(current);
    const version = await expectedRevision(api, input, current.card);
    if (!version || current.card.revision !== version)
      fail('content_conflict', '父卡已更新，不能覆盖补充阅读顺序。');
    if (!rec.intended) {
      rec.documentId = id;
      rec.beforeOrder = current.card.attrs[readingOrderAttr] ?? null;
      rec.beforeRevision = version;
      rec.guard = nodeGuard(current.card);
      rec.membership = JSON.stringify(current.membership);
      const selected = new Set(readings);
      rec.intended = JSON.stringify([...readings, ...current.ids.filter(child => !selected.has(child))]);
      persist();
    }
    if (JSON.stringify(current.membership) !== rec.membership) fail('content_conflict', '父卡的补充阅读成员已变化。');
    await api.setAttrs(id, { [readingOrderAttr]: rec.intended });
    await api.flush();
    return confirm(await snapshot());
  });
}
