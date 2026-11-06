import { fromMarkdown } from 'mdast-util-from-markdown';
import { parseFragment } from 'parse5';
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const widthOf = value => /^\d+(?:\.\d+)?$/.test(value ?? '') && Number(value) > 0 && Number(value) <= 4096 ? String(Math.round(Number(value))) : '';
const image = (src, alt, title, width) => width ? `<img src="${escape(src)}" alt="${escape(alt ?? '')}"${title ? ` title="${escape(title)}"` : ''} width="${width}" />` : `![${String(alt ?? '').replace(/[\[\]\\]/g, '\\$&')}](<${src}>${title ? ' '+JSON.stringify(title) : ''})`;
// SiYuan stores image display width as an IAL; expose it as portable bounded HTML.
// Work from parsed nodes so literal examples inside code are never rewritten.
export function imageMarkdown(source) {
  const replacements = [];
  const visit = node => {
    if (node.type === 'html' && /^<img\s[^>]*\/?>$/.test(node.value.trim())) {
      const element = parseFragment(node.value.trim()).childNodes[0];
      const attrs = Object.fromEntries((element?.attrs ?? []).map(a => [a.name, a.value]));
      if (attrs.src && Object.keys(attrs).every(k => ['src', 'alt', 'title', 'width', 'height'].includes(k))) replacements.push([node.position.start.offset, node.position.end.offset, image(attrs.src, attrs.alt, attrs.title, widthOf(attrs.width))]);
    } else if (node.type === 'image') {
      const tail = source.slice(node.position.end.offset).match(/^\{:\s+style="width:\s*([\d.]+)px;?"\s*\}/);
      if (tail && widthOf(tail[1])) replacements.push([node.position.start.offset, node.position.end.offset + tail[0].length, image(node.url, node.alt, node.title, widthOf(tail[1]))]);
    }
    if (!['code', 'inlineCode', 'html'].includes(node.type)) for (const child of node.children ?? []) visit(child);
  };
  visit(fromMarkdown(source));
  for (const [start, end, value] of replacements.sort((a,b) => b[0]-a[0])) source = source.slice(0,start)+value+source.slice(end);
  return source;
}
