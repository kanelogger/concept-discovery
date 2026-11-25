import { parseFragment } from 'parse5';
import { hash } from '../lib/siyuan.mjs';
import { renderMarkdown } from './render.mjs';

const contextTags = new Set(['p', 'li', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const sentences = new Intl.Segmenter('zh', { granularity: 'sentence' });
const attr = (element, name) => element.attrs?.find(attribute => attribute.name === name)?.value;
const tidy = text => text.replaceAll('\u200b', '').replace(/\s+/g, ' ').trim();

function destination(href, base) {
  try {
    const url = new URL(href, base);
    if (url.origin !== base.origin || url.username || url.password) return;
    const path = /^\/cards\/([^/]+)$/.exec(url.pathname);
    const ref = path ? decodeURIComponent(path[1]) : url.pathname === '/' && url.searchParams.get('id');
    if (ref && url.pathname !== '/cards/new') return { ref, fragment: decodeURIComponent(url.hash.slice(1)) };
  } catch {
    // The reader cannot resolve a malformed URL or fragment.
  }
}

function contextFor(root) {
  let content = '';
  const ranges = new Map();
  function visit(node) {
    const start = content.length;
    if (node.nodeName === '#text') content += node.value;
    else if (node.tagName === 'br') content += '\n';
    else if (node.tagName === 'img') content += attr(node, 'alt') ?? '';
    else for (const child of node.childNodes ?? []) visit(child);
    if (node.tagName === 'a') ranges.set(node, [start, content.length]);
  }
  visit(root);
  return { content, ranges, segments: sentences.segment(content) };
}

function excerptFor(context, link) {
  const { content, ranges, segments } = context;
  const [start, end] = ranges.get(link);
  const first = segments.containing(start);
  const last = segments.containing(Math.max(start, end - 1));
  // When a quote is exceptionally long, keep the linked words in view.
  const left = Math.max(first?.index ?? start, start - 160);
  const right = Math.min(last ? last.index + last.segment.length : end, Math.max(start + 160, Math.min(end, start + 320)));
  const excerpt = tidy(content.slice(left, right));
  return [(left > (first?.index ?? start) ? '…' : '') + excerpt +
    (last && right < last.index + last.segment.length ? '…' : ''), tidy(content.slice(start, end))];
}

// Index exactly the safe links the reader can click, after whole-document
// reference definitions, block refs and legacy HTML have been resolved.
export function renderCardReferences(markdown, { origin, id, annotate = true, ...renderOptions }) {
  const html = renderMarkdown(markdown, renderOptions);
  if (!html.includes('<a ')) return { html, references: [] };
  const base = new URL('/cards/' + encodeURIComponent(id), origin);
  const tree = parseFragment(html, { sourceCodeLocationInfo: annotate });
  const counts = new Map(), contexts = new Map(), references = [], edits = [];
  function bookmark(node, anchor) {
    const { startOffset, endOffset } = node.sourceCodeLocation.startTag;
    // Preserve the original block bookmark beside the focusable citation link.
    const originalId = node.sourceCodeLocation.attrs?.id;
    if (originalId) {
      const originalAttribute = html.slice(originalId.startOffset, originalId.endOffset);
      edits.push([startOffset, startOffset, '<span ' + originalAttribute + '></span>']);
      edits.push([originalId.startOffset, originalId.endOffset, 'id="' + anchor + '"']);
    } else {
      edits.push([endOffset - 1, endOffset - 1, ' id="' + anchor + '"']);
    }
  }
  function visit(node, context, member) {
    if (contextTags.has(node.tagName)) context = node;
    if (attr(node, 'data-scenario-member') !== undefined) member = true;
    if (node.tagName === 'a') {
      const target = destination(attr(node, 'href'), base);
      if (target) {
        // Safe legacy HTML can leave prose and anchors directly in the fragment.
        const root = context ?? tree;
        if (!contexts.has(root)) contexts.set(root, contextFor(root));
        const [excerpt, label] = excerptFor(contexts.get(root), node);
        const key = hash([target.ref, target.fragment, label, excerpt]).slice(0, 24);
        const ordinal = (counts.get(key) ?? 0) + 1;
        counts.set(key, ordinal);
        const anchor = 'cd-ref-' + key + '-' + ordinal;
        if (annotate) bookmark(node, anchor);
        if (!member) references.push({ ...target, anchor, excerpt: excerpt || attr(node, 'href') });
      }
    }
    for (const child of node.childNodes ?? []) visit(child, context, member);
  }
  visit(tree, null, false);
  if (!edits.length) return { html, references };
  const chunks = [];
  let start = 0;
  for (const [offset, end, value] of edits) {
    chunks.push(html.slice(start, offset), value);
    start = end;
  }
  return { html: chunks.join('') + html.slice(start), references };
}
