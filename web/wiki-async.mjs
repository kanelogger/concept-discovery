const mutations = new Set(['import', 'generate', 'file', 'open']);

/** A view may change while its request still owns a pending operation. */
export function createWikiOperations({ active = false, key = '' } = {}) {
  let epoch = 0;
  const pending = new Map();
  return {
    setView(next) { if (active !== next.active || key !== next.key) { active = next.active; key = next.key; epoch++; } },
    changeView(nextKey) { key = nextKey; epoch++; },
    begin(kind) { const ticket = Object.freeze({ id: Symbol(kind), kind, epoch }); pending.set(ticket.id, ticket); return ticket; },
    isCurrent(ticket) { return active && ticket.epoch === epoch && pending.get(ticket.id) === ticket; },
    finish(ticket) { if (pending.get(ticket.id) === ticket) pending.delete(ticket.id); },
    busy() { const values = [...pending.values()]; return values.find(value => mutations.has(value.kind))?.kind || values.at(-1)?.kind || ''; },
  };
}
export function decodeWikiSource(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error('文件不是有效的 UTF-8 文本。请先转换为 UTF-8 后重新选择，当前草稿未改动。'); }
}
