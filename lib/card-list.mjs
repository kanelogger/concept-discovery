import { fromMarkdown } from 'mdast-util-from-markdown';
import { readableMarkdown } from './compact.mjs';
import { normalize } from './siyuan.mjs';
const text = node => node.value ?? (node.children ?? []).map(text).join('');
export function documentTags(markdown, { proseOnly = false } = {}) {
  const readable = readableMarkdown(normalize(markdown));
  return tagsFromNodes(fromMarkdown(readable).children, { proseOnly });
}
export function tagsFromNodes(nodes, { proseOnly = false } = {}) {
  const tags = [];
  let depth = null;
  for (const node of nodes) {
    if (node.type === 'heading') {
      if (depth !== null && node.depth <= depth) depth = null;
      if (/^(?:中文\s*[·・]\s*)?标签$/.test(text(node).trim())) depth = node.depth;
      continue;
    }
    if (depth === null || ['html','thematicBreak'].includes(node.type)) continue;
    if (proseOnly && !['list', 'paragraph'].includes(node.type)) continue;
    const values = node.type === 'list' ? node.children.map(text) : [text(node)];
    for (const value of values) for (const tag of node.type === 'list' ? [value] : value.split(/[、\n]+/)) {
      const clean = tag.replace(/\u200b/g,'').trim().replace(/^#+/, '').trim().normalize('NFC');
      if (clean && !/^\{[:{]|^\}\}/.test(clean)) tags.push(clean);
    }
  }
  return [...new Set(tags)];
}
export function disciplinesFromTags(tags) {
  const names = new Set();
  for (const tag of tags) {
    const name = /^学科\s*[:：]\s*(.+)$/.exec(tag)?.[1]?.trim();
    if (name) names.add(name);
  }
  return [...names];
}
export { listOptions } from './read-contract.mjs';
export async function mapConcurrent(rows, load) {
  const values = new Array(rows.length);let next = 0;
  await Promise.all(Array.from({length:Math.min(8,rows.length)},async()=>{for(;;){const at=next++;if(at>=rows.length)return;values[at]=await load(rows[at]);}}));
  return values;
}
