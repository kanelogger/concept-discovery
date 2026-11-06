import MarkdownIt from "markdown-it";
import linkifyText from "markdown-it/lib/rules_core/linkify.mjs";
import { parseFragment } from "parse5";
import { empty, preferChineseLegacyMarkdown } from "../lib/markdown.mjs";

const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const blockID = /^\d{14}-[a-z0-9]{7}$/;
function destination(value) {
  const match = /^kane:\/\/blocks\/(\d{14}-[a-z0-9]{7})$/.exec(value);
  return match ? "/?id=" + match[1] : value;
}

// HTML is tokenized as a whole so Markdown punctuation inside attributes never
// becomes emphasis. Both HTML renderer rules are replaced; raw HTML is never emitted.
const md = new MarkdownIt({ html: true, linkify: true });
const defaultValidateLink = md.validateLink;
md.validateLink = value => /^kane:/i.test(value)
  ? destination(value) !== value
  : !/^siyuan:/i.test(value) && defaultValidateLink(value);
// Legacy fields escape punctuation such as dots inside URLs. Match the
// visible text after Markdown-it has joined those escaped characters.
md.inline.ruler.disable('linkify');
md.core.ruler.disable('linkify');
md.core.ruler.after('text_join', 'visible_links', linkifyText);
// Match the editor's bare web links without consuming adjacent Chinese prose.
const bareWebAddress = /^[-a-z0-9@:%._+~#=]{1,256}\.[a-z0-9()]{1,6}\b[-a-z0-9()@:%_+.~#?&\/=]*/i;
function webAddressLength(text, offset) {
  const tail = text.slice(offset);
  let match = bareWebAddress.exec(tail)?.[0].replace(/\.+$/, '');
  if (!match) return 0;
  let closing = (match.match(/\)/g)?.length ?? 0) - (match.match(/\(/g)?.length ?? 0);
  while (closing > 0 && match.endsWith(')')) {
    match = match.slice(0, -1);
    closing--;
  }
  const rest = tail.slice(match.length);
  // A partial match inside a longer address would open the wrong page.
  if (rest && !/^[.,!?;:)\]]*(?:[\s，。！？；：、）》】…]|$)/.test(rest)) return 0;
  return match.length;
}
md.linkify.set({ fuzzyLink: false })
  .add('http:', { validate(text, offset) {
    if (!text.startsWith('//', offset)) return 0;
    const length = webAddressLength(text, offset + 2);
    return length ? length + 2 : 0;
  } })
  .add('https:', 'http:')
  .add('www.', {
    validate: webAddressLength,
    normalize(match) { match.url = 'https://' + match.raw; },
  })
  .add('ftp:', null)
  .add('//', null);
const defaultLink = md.renderer.rules.link_open ?? ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
md.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index].attrSet("href", destination(tokens[index].attrGet("href") ?? ""));
  tokens[index].attrSet("rel", "noreferrer noopener");
  return defaultLink(tokens, index, options, env, self);
};
function safeURL(value) {
  if (!value) return false;
  try {
    // Browsers strip protocol tabs/newlines; validate the canonical URL too.
    const url = new URL(destination(value), 'https://local.invalid');
    // Exact Kane links have already become local paths. Do not emit a
    // custom-protocol link that only becomes valid after URL normalization.
    return url.protocol !== 'kane:' && md.validateLink(url.href);
  } catch { return false; }
}
const attributes = (node) => Object.fromEntries((node.attrs ?? []).map(({ name, value }) => [name, value]));
function image(node) {
  const attrs = attributes(node);
  if (!safeURL(attrs.src)) return "";
  const dimensions = ['width', 'height'].filter(key => /^[1-9]\d{0,3}$/.test(attrs[key] ?? '') && Number(attrs[key]) <= 4096).map(key => ` ${key}="${attrs[key]}"`).join('');
  return `<img src="${escape(destination(attrs.src))}" alt="${escape(attrs.alt ?? "")}"${dimensions} loading="lazy">`;
}
function anchor(node) {
  const attrs = attributes(node);
  if (!safeURL(attrs.href)) return "";
  return `<a href="${escape(destination(attrs.href))}" rel="noreferrer noopener">`;
}
function safeHTML(node, source) {
  if (node.nodeName === "#text") return escape(node.value);
  if (node.nodeName === "#comment") return escape("<!--" + node.data + "-->");
  const children = node.tagName === "template" ? node.content?.childNodes : node.childNodes;
  const content = (children ?? []).map((child) => safeHTML(child, source)).join("");
  if (!node.tagName) return content;
  if (node.tagName === "img" && image(node)) return image(node);
  if (node.tagName === "a" && anchor(node)) return anchor(node) + content + "</a>";
  if (node.tagName === "br") return "<br>";
  const location = node.sourceCodeLocation;
  const start = location?.startTag ? source.slice(location.startTag.startOffset, location.startTag.endOffset) : "<" + node.tagName + ">";
  const end = location?.endTag ? source.slice(location.endTag.startOffset, location.endTag.endOffset) : "";
  return escape(start) + content + escape(end);
}
md.renderer.rules.html_block = (tokens, index) => {
  const token = tokens[index];
  const source = token.content;
  const rendered = safeHTML(parseFragment(source, { sourceCodeLocationInfo: true }), source);
  const id = token.attrGet("id");
  if (!id) return rendered;
  const openingTag = /^(\s*<(?:img|a|br))(?=[\s>])/;
  return openingTag.test(rendered)
    ? rendered.replace(openingTag, '$1 id="' + id + '"')
    : '<span id="' + id + '"></span>' + rendered;
};
// Inline HTML is escaped unless explicitly converted below to a safe image or
// a paired link. An unmatched opening anchor cannot capture the rest of the page.
md.renderer.rules.html_inline = (tokens, index) => escape(tokens[index].content);
md.renderer.rules.safe_legacy = (tokens, index) => tokens[index].content;
md.renderer.rules.block_anchor = (tokens, index) => '<span id="' + tokens[index].content + '"></span>';

function convertInline(nodes) {
  for (let index = 0; index < nodes.length; index++) {
    const token = nodes[index];
    if (token.children) convertInline(token.children);
    if (token.type === "html_inline") {
      const node = parseFragment(token.content).childNodes?.[0];
      if (node?.tagName === "img" && image(node)) {
        token.type = "safe_legacy";
        token.content = image(node);
      } else if (/^<a\s/i.test(token.content) && node?.tagName === "a" && anchor(node)) {
        let end = index + 1;
        while (end < nodes.length && !(nodes[end].type === "html_inline" && /^<\/a\s*>$/i.test(nodes[end].content))) {
          if (nodes[end].type === "html_inline" && /^<a\s/i.test(nodes[end].content)) break;
          end++;
        }
        if (end < nodes.length && /^<\/a\s*>$/i.test(nodes[end].content)) {
          token.type = "safe_legacy"; token.content = anchor(node);
          nodes[end].type = "safe_legacy"; nodes[end].content = "</a>";
        }
      }
    }
    if (token.type !== "text") continue;
    const refs = [...token.content.matchAll(/\(\((\d{14}-[a-z0-9]{7})(?:\s+['"]([^\n]*?)['"])?\)\)/g)];
    if (!refs.length) continue;
    const replacement = []; let offset = 0;
    const text = (value) => { if (value) { const item = new token.constructor("text", "", 0); item.content = value; replacement.push(item); } };
    for (const match of refs) {
      text(token.content.slice(offset, match.index));
      const open = new token.constructor("link_open", "a", 1); open.attrs = [["href", "/?id=" + match[1]]]; replacement.push(open);
      text(match[2] || "相关内容"); replacement.push(new token.constructor("link_close", "a", -1));
      offset = match.index + match[0].length;
    }
    text(token.content.slice(offset)); nodes.splice(index, 1, ...replacement); index += replacement.length - 1;
  }
}
// SiYuan may drop the zero-width placeholder when exporting a legacy field.
function omitEmptyFixedFields(tokens) {
  const visible = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type === "heading_open" && token.tag === "h2" && token.level === 0 &&
        /^(?:中文|English) · /.test(tokens[index + 1]?.content ?? "")) {
      const placeholder = tokens[index + 3]?.type === "paragraph_open" &&
        tokens[index + 4]?.content === empty && tokens[index + 5]?.type === "paragraph_close";
      const end = index + (placeholder ? 6 : 3);
      const next = tokens[end];
      if (!next || (next.type === "heading_open" && ["h1", "h2"].includes(next.tag))) {
        index = end - 1;
        continue;
      }
    }
    visible.push(token);
  }
  return visible;
}

function anchorBlocks(tokens, source, blocks) {
  const byLine = new Map();
  const roots = [];
  for (const token of tokens) {
    if (token.map && !token.hidden && (token.tag || token.type === "html_block") && !byLine.has(token.map[0])) {
      byLine.set(token.map[0], token);
      if (token.level === 0) roots.push(token);
    }
  }
  const fallbacks = new Map();
  let cursor = 0;
  let line = 0;
  for (const block of blocks) {
    if (!blockID.test(block.id)) continue;
    const text = block.markdown.trim();
    const start = text ? source.indexOf(text, cursor) : -1;
    if (start >= 0) line += source.slice(cursor, start).split("\n").length - 1;
    const token = start >= 0 ? byLine.get(line) : undefined;
    if (token && !token.attrGet("id")) token.attrSet("id", block.id);
    else {
      // Reference definitions have no visible token but can still be linked to.
      const next = roots.find(candidate => candidate.map[0] >= line);
      if (!fallbacks.has(next)) fallbacks.set(next, []);
      fallbacks.get(next).push({ type: "block_anchor", content: block.id });
    }
    if (start >= 0) {
      line += text.split("\n").length - 1;
      cursor = start + text.length;
    }
  }
  return [...tokens.flatMap(token => [...(fallbacks.get(token) ?? []), token]), ...(fallbacks.get(undefined) ?? [])];
}

export function renderMarkdown(markdown, { legacyFixedFields = false, blocks = [] } = {}) {
  const source = String(markdown ?? "");
  const parsed = md.parse(legacyFixedFields ? preferChineseLegacyMarkdown(source) : source, {});
  const tokens = legacyFixedFields ? omitEmptyFixedFields(parsed)
    : blocks.length ? anchorBlocks(parsed, source, blocks) : parsed;
  convertInline(tokens);
  return md.renderer.render(tokens, md.options, {});
}
export function validBlockID(value) { return blockID.test(value); }
