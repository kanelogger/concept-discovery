const fieldNames = new Map([
  ["名称", "name"],
  ["别名", "aliases"],
  ["标签", "tags"],
  ["理解", "understanding"],
  ["核心理解", "understanding"],
  ["适用情境", "situation"],
  ["适用任务", "situation"],
]);

const normalizeText = value => value.replace(/\u200b/g, "").trim().normalize("NFC");
const headingLevel = node => /^H[1-6]$/.test(node.tagName) ? Number(node.tagName[1]) : 0;
const emptyAnchor = node => node.tagName === "SPAN" && node.id && !node.hasChildNodes();

function spanStart(nodes, index) {
  while (index > 0) {
    const previous = nodes[index - 1];
    if (!emptyAnchor(previous) && !(previous.nodeType === 3 && !previous.textContent.trim())) break;
    index--;
  }
  return index;
}

function inlineText(node, allowParagraphs = false) {
  return [...node.querySelectorAll("*")].every(child =>
    /^(EM|STRONG|CODE|S)$/.test(child.tagName) || emptyAnchor(child) || (allowParagraphs && child.tagName === "P"));
}

function matchesTags(elements, tags) {
  const values = [];
  for (const node of elements) {
    if (node.tagName === "P" && inlineText(node)) {
      values.push(...node.textContent.split(/[、\n]+/));
    } else if (/^(UL|OL)$/.test(node.tagName) && [...node.children].every(item => item.tagName === "LI" && inlineText(item, true))) {
      values.push(...[...node.children].map(item => item.textContent));
    } else {
      return false;
    }
  }
  const names = values.map(value => normalizeText(value).replace(/^#+/, "").trim()).filter(Boolean);
  return names.length > 0 && names.every(name => tags.includes(name));
}

function anchorIds(nodes) {
  return nodes.filter(node => node.nodeType === 1)
    .flatMap(node => [node.id, ...[...node.querySelectorAll("[id]")].map(child => child.id)])
    .filter(Boolean);
}

export function prepareCardBody(card) {
  // Reorder the sanitized view alone. Assign synthetic heading IDs before
  // moving sections so previously bookmarked IDs keep pointing to the same text.
  const template = document.createElement("template");
  template.innerHTML = card?.html || "<p>这张卡片暂无正文。</p>";
  const nodes = [...template.content.childNodes];
  const headings = nodes.flatMap((node, index) => {
    const level = headingLevel(node);
    return level ? [{ node, index, level, start: spanStart(nodes, index) }] : [];
  });
  const ids = new Set(anchorIds(nodes));
  let nextId = 1;
  for (const { node } of headings) {
    if (!node.textContent.trim()) continue;
    if (!node.id) {
      while (ids.has(`cd-section-${nextId}`)) nextId++;
      node.id = `cd-section-${nextId++}`;
      ids.add(node.id);
    }
    node.tabIndex = -1;
  }

  const promoted = { aliases: null, understanding: null, situation: null };
  const metadata = { name: [], tags: [] };
  for (let index = 0; index < headings.length; index++) {
    const { node, index: headingIndex, level, start } = headings[index];
    const kind = fieldNames.get(normalizeText(node.textContent).replace(/^中文\s*[·・]\s*/, ""));
    if (!kind || promoted[kind]) continue;
    let next = index + 1;
    while (next < headings.length && headings[next].level > level) next++;
    const end = headings[next]?.start ?? nodes.length;
    const contents = nodes.slice(headingIndex + 1, end);
    const elements = contents.filter(child => child.nodeType === 1 && !emptyAnchor(child));
    if (!contents.some(child => normalizeText(child.textContent) || child.matches?.("img, hr, table") || child.querySelector?.("img"))) continue;

    const section = nodes.slice(start, end);
    if (kind === "name" || kind === "tags") {
      // Only replace content that the header can express in full.
      if (contents.some(child => child.nodeType === 3 && normalizeText(child.textContent))) continue;
      const matches = kind === "name"
        ? elements.length === 1 && elements[0].tagName === "P" && inlineText(elements[0]) &&
          normalizeText(elements[0].textContent) === normalizeText(card.title)
        : matchesTags(elements, card.tags ?? []);
      if (!matches) continue;
      metadata[kind].push(...anchorIds(section));
      section.forEach(child => child.remove());
    } else {
      const field = document.createElement("template");
      field.content.append(...section);
      if (kind === "aliases") {
        const values = document.createElement("div");
        values.className = "prose reader-alias-values";
        values.append(...contents);
        for (const list of values.children) {
          if (list.tagName === "UL") list.setAttribute("role", "list");
        }
        field.content.append(values);
      }
      promoted[kind] = field;
    }
    index = next - 1;
  }

  const sections = [];
  for (const [kind, fragment] of [...Object.entries(promoted), ["body", template]]) {
    if (!fragment || kind === "aliases") continue;
    for (const node of fragment.content.children) {
      if (headingLevel(node) && node.id && normalizeText(node.textContent)) {
        sections.push({ id: node.id, label: normalizeText(node.textContent).replace(/\s+/g, " "), overview: kind !== "body" });
      }
    }
  }
  return {
    html: template.innerHTML.trim(),
    aliases: promoted.aliases?.innerHTML ?? "",
    understanding: promoted.understanding?.innerHTML ?? "",
    situation: promoted.situation?.innerHTML ?? "",
    metadata,
    sections: sections.length >= 3 ? sections : [],
  };
}
