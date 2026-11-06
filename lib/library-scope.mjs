import { activePath, quote } from "./siyuan.mjs";

export { activePath } from "./siyuan.mjs";

export function cardScope(config, card = "b") {
  const prefix = quote("/" + config.libraryRootId + "/");
  return `${card}.box = ${quote(config.notebookId)}
    AND ${card}.type = 'd' AND ${card}.root_id = ${card}.id
    AND substr(${card}.path, 1, length(${prefix})) = ${prefix}
    AND ${activePath(card+".path",card+".box")}
    AND NOT EXISTS (
      SELECT 1 FROM attributes kind WHERE kind.block_id = ${card}.id
        AND kind.name = 'custom-cd-kind' AND kind.value <> 'concept'
    )`;
}

// Keep the parent/root ID lookup ahead of the broad notebook index in SQLite.
// Unary + disables box index selection; the box and path checks still scope content.
export function readingIds(card = "b") {
  return `SELECT reading.id FROM attributes parent JOIN blocks reading ON reading.id = parent.block_id
    WHERE parent.name = 'custom-cd-parent' AND parent.value = ${card}.id
    AND +reading.box = ${card}.box AND reading.id <> ${card}.id
    AND reading.type = 'd' AND reading.root_id = reading.id
    AND ${activePath('reading.path','reading.box')}
    AND substr(${card}.path, -3) = '.sy'
    AND substr(reading.path, 1, length(${card}.path) - 2) = substr(${card}.path, 1, length(${card}.path) - 3) || '/'
    AND NOT EXISTS (
      SELECT 1 FROM attributes kind WHERE kind.block_id = reading.id
        AND kind.name = 'custom-cd-kind' AND kind.value NOT IN ('', 'concept', 'article')
    )`;
}

const sourceScope = card => `+d.box = ${card}.box AND d.id IN (SELECT ${card}.id UNION ALL ${readingIds(card)})`;
const sourceBlocks = "blocks s ON s.root_id = d.id AND +s.box = d.box AND s.path = d.path";

export function contentJoin(card = "b") {
  return `JOIN blocks d ON ${sourceScope(card)} CROSS JOIN ${sourceBlocks}`;
}

export function scopedContent(card = "b") {
  return `FROM blocks d CROSS JOIN ${sourceBlocks} WHERE ${sourceScope(card)}`;
}

export function splitQuery(query) {
  return query.trim().split(/\s+/).filter(Boolean);
}

export function termMatch(column, terms) {
  return terms.map(term => `${column} LIKE ${quote("%" + term.replace(/[\\%_]/g, "\\$&") + "%")} ESCAPE '\\'`).join(" OR ");
}

export function cardMatch(terms) {
  return `EXISTS (SELECT 1 ${scopedContent()} AND (${termMatch("s.content", terms)}))`;
}
