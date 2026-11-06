import { fromMarkdown } from 'mdast-util-from-markdown';
import { readableMarkdown } from './compact.mjs';
import { preferChineseLegacyMarkdown } from './markdown.mjs';
import { fail, normalize } from './siyuan.mjs';
const text = node => node.value ?? (node.children ?? []).map(text).join('');
export function documentTags(markdown, { legacyFixedFields = false } = {}) {
  const readable = readableMarkdown(normalize(markdown));
  const nodes = fromMarkdown(legacyFixedFields ? preferChineseLegacyMarkdown(readable) : readable).children;
  const tags = [];
  let depth = null;
  for (const node of nodes) {
    if (node.type === 'heading') {
      if (depth !== null && node.depth <= depth) depth = null;
      if (/^(?:(?:中文|English)\s*[·・]\s*)?(?:标签|tags)$/i.test(text(node).trim())) depth = node.depth;
      continue;
    }
    if (depth === null || ['html','thematicBreak'].includes(node.type)) continue;
    const values = node.type === 'list' ? node.children.map(text) : [text(node)];
    for (const value of values) for (const tag of node.type === 'list' ? [value] : value.split(/[、\n]+/)) {
      const clean = tag.replace(/\u200b/g,'').trim().replace(/^#+/, '').trim().normalize('NFC');
      if (clean && !/^\{[:{]|^\}\}/.test(clean)) tags.push(clean);
    }
  }
  return [...new Set(tags)];
}
export function listOptions({ offset = 0, limit = 50, query = '', tag = '', updatedFrom = '', updatedTo = '', includeTags = false } = {}) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100 || typeof query !== 'string' || query.length > 1000 || typeof tag !== 'string' || tag.length > 100 || typeof includeTags !== 'boolean') fail('invalid_input', 'Invalid list filters or pagination');
  for (const date of [updatedFrom, updatedTo]) {
    if (typeof date !== 'string') fail('invalid_input','Invalid update date');
    if (date) {
      const parsed=Date.parse(date+'T00:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(parsed)||new Date(parsed).toISOString().slice(0,10)!==date) fail('invalid_input','Invalid update date');
    }
  }
  if (updatedFrom && updatedTo && updatedFrom > updatedTo) fail('invalid_input', 'Update date range is reversed');
  return { offset, limit, query: query.trim(), tag: tag.trim().normalize('NFC'), updatedFrom, updatedTo, includeTags };
}
export async function mapConcurrent(rows, load) {
  const values = new Array(rows.length);let next = 0;
  await Promise.all(Array.from({length:Math.min(8,rows.length)},async()=>{for(;;){const at=next++;if(at>=rows.length)return;values[at]=await load(rows[at]);}}));
  return values;
}
