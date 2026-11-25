import { fromMarkdown } from "mdast-util-from-markdown";
// mdast locates a fenced block at its opening marker. The line indentation
// also belongs to the fence: it determines indentation removed from its body.
export function markdownStart(source, node) {
  const start = node.position.start.offset;
  if (node.type !== "code") return start;
  const lineStart = start - (node.position.start.column - 1);
  return /^[ \t]*$/.test(source.slice(lineStart, start)) ? lineStart : start;
}

export const empty = "\u200b";
export const escapeText = (s) =>
  s.replaceAll("&", "&amp;").replace(/[\\`*_{}\[\]()#+.!|>~-]/g, "\\$&");
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
