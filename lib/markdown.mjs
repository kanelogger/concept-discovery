import { fromMarkdown } from "mdast-util-from-markdown";
export const empty = "\u200b";
export const escapeText = (s) =>
  s.replaceAll("&", "&amp;").replace(/[\\`*_{}\[\]()#+.!|>~-]/g, "\\$&");
export function renderValue(value) {
  if (Array.isArray(value))
    return value.length
      ? value.map((s) => "- " + escapeText(s).replace(/\n/g, "\n  ")).join("\n")
      : empty;
  return value ? escapeText(value) : empty;
}
function plain(n) {
  if (n.type === "link") {
    const label = (n.children ?? []).map(plain).join("");
    return label === n.url ? n.url : `[${label}](${n.url})`;
  }
  if (n.type === "image") return `![${n.alt ?? ""}](${n.url})`;
  if (n.type === "break") return "\n";
  if (typeof n.value === "string") return n.value;
  return (n.children ?? []).map(plain).join("");
}

export function preferChineseLegacyMarkdown(markdown) {
  const nodes = fromMarkdown(markdown).children;
  const heading = (node, depth, pattern) => node?.type === "heading" && node.depth === depth && pattern.test(plain(node));
  const chineseName = nodes.findIndex(node => heading(node, 2, /^中文 · 名称$/));
  const name = nodes[chineseName + 1];
  if (chineseName < 0 || name?.type !== "paragraph" || !plain(name).replaceAll(empty, "").trim()) return markdown;
  const english = nodes.findIndex((node, index) => index > chineseName && heading(node, 1, /^Recall[:：]/) &&
    heading(nodes[index + 1], 2, /^English · 名称$/));
  if (english < 0) return markdown;
  const nextSection = nodes.slice(english + 2).find(node => node.type === "heading" && node.depth <= 2 &&
    !heading(node, 2, /^English · /));
  return markdown.slice(0, nodes[english].position.start.offset) +
    (nextSection ? markdown.slice(nextSection.position.start.offset) : "");
}

export function readValue(markdown, isArray) {
  const nodes = fromMarkdown(markdown).children;
  if (!nodes.length || (nodes.length === 1 && plain(nodes[0]) === empty))
    return isArray ? [] : "";
  if (isArray) {
    if (nodes.length !== 1 || nodes[0].type !== "list")
      throw new Error("List field structure changed");
    return nodes[0].children.map((item) =>
      item.children.map(plain).join("\n\n"),
    );
  }
  return nodes.map(plain).join("\n\n");
}
export function markdownTree(s) {
  const tree = fromMarkdown(s);
  function clean(n) {
    const result = {};
    for (const [k, v] of Object.entries(n)) {
      if (["position", "spread"].includes(k)) continue;
      result[k] = Array.isArray(v)
        ? v
            .map((x) => (x && typeof x === "object" ? clean(x) : x))
            .filter((x) => !(x?.type === "text" && x.value === ""))
        : k === "value" && n.type === "text"
          ? v.replace(/^\u200b+|\u200b+$/g, "")
          : v;
    }
    return result;
  }
  return clean(tree);
}
// Exact invariants independent of rendering whitespace and list looseness.
export function criticalMarkdown(markdown) {
  const result = [];
  function visit(n) {
    if (["code", "inlineCode", "image", "link", "html"].includes(n.type)) {
      const { children, position, ...value } = n;
      result.push(value);
    }
    for (const c of n.children ?? []) visit(c);
  }
  visit(fromMarkdown(markdown));
  return result;
}
