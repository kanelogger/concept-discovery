import { fromMarkdown } from "mdast-util-from-markdown";

export const taskDescriptionLimit = 600;
const labels = new Set(["适用任务", "适用情境", "中文 · 适用情境"]);
const text = node => node.value ?? (node.children ?? []).map(text).join("");

// A view over the existing Markdown section, never a second stored copy.
export function taskDescriptionSection(markdown = "") {
  const nodes = fromMarkdown(markdown).children;
  const index = nodes.findIndex(node => node.type === "heading" && node.depth === 2 && labels.has(text(node).trim()));
  if (index < 0) return null;
  const heading = nodes[index];
  const next = nodes.slice(index + 1).find(node => node.type === "heading" && node.depth <= heading.depth);
  const end = next?.position.start.offset ?? markdown.length;
  return { headingStart: heading.position.start.offset, start: heading.position.end.offset, end, description: markdown.slice(heading.position.end.offset, end).trim() };
}
export const taskDescription = markdown => taskDescriptionSection(markdown)?.description ?? "";
export function withTaskDescription(markdown, description) {
  const section = taskDescriptionSection(markdown);
  if (section) return markdown.slice(0, section.start) + "\n\n" + description.trim() + "\n\n" + markdown.slice(section.end);
  return description.trim() ? markdown.trimEnd() + (markdown.trim() ? "\n\n" : "") + "## 适用任务\n\n" + description.trim() : markdown;
}

export function descriptionBody(markdown = "") {
  const section = taskDescriptionSection(markdown);
  return section ? markdown.slice(0, section.headingStart) + markdown.slice(section.end) : markdown;
}
export function composeDescription(body, description, original = "") {
  const section = taskDescriptionSection(original);
  if (!section) return !description.trim() ? body : withTaskDescription(body, description);
  const heading = original.slice(section.headingStart, section.start);
  const suffix = original.slice(section.end);
  const anchor = suffix.split("\n")[0];
  const headings = fromMarkdown(body).children.filter(node => node.type === "heading");
  const nextHeading = headings.find(node => body.slice(node.position.start.offset) === suffix) ??
    headings.find(node => body.slice(node.position.start.offset, node.position.end.offset) === anchor);
  const at = suffix ? nextHeading?.position.start.offset ?? -1 : -1;
  const insertion = heading + "\n\n" + description.trim() + "\n\n";
  return at >= 0 ? body.slice(0, at) + insertion + body.slice(at)
    : body.trimEnd() + (body.trim() ? "\n\n" : "") + insertion.trimEnd();
}

export const descriptionText = markdown => fromMarkdown(markdown).children.map(text).join(" ").replace(/\s+/g, " ").trim();
