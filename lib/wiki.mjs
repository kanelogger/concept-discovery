import { dirname, resolve } from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import { fail } from "./siyuan.mjs";
import { execute } from "./commands.mjs";
import { createWikiStore } from "./wiki-store.mjs";
import { generateWikiDraft } from "./wiki-draft.mjs";

export const wikiCommands = new Set([
  "source-import", "sources-list", "source-get", "wiki-draft", "wiki-card",
  "wiki-proposals", "wiki-proposal", "wiki-events",
]);

export function headingQuestion(markdown) {
  const nodes = fromMarkdown(markdown).children;
  const nodeText = node => node.value ?? (node.children ?? []).map(nodeText).join("");
  for (let at = 0; at < nodes.length; at++) {
    if (nodes[at].type !== "heading") continue;
    const title = nodeText(nodes[at]).trim().replace(/^中文\s*[·・]\s*/, "");
    const direct = /^(?:自测|问题)[：:]\s*(.+)$/.exec(title);
    if (direct) return direct[1];
    if (/^(?:自测|自问|问题)$/.test(title)) {
      const next = nodes[at + 1];
      if (next && next.type !== "heading") return nodeText(next).trim().split("\n")[0].slice(0, 600);
    }
  }
  return "";
}

/** Sources are durable; generated drafts are read-only and saved through Documents. */
export async function executeWiki(api, command, input = {}, options = {}) {
  if (!wikiCommands.has(command)) fail("invalid_command", "此知识整理操作已下线或未开放。");
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("invalid_input", "需要JSON对象。");
  const { publicUrl = "", complete, signal, executeCommand = execute } = options;
  const libraryId = await api.identity({ signal });
  signal?.throwIfAborted();
  const store = createWikiStore(options.wikiRoot ?? resolve(dirname(api.c.dataDir), "wiki"), libraryId);
  const document = id => executeCommand(api, "get-document", { id }, { publicUrl, signal });

  if (command === "source-import") return store.importSource(input);
  if (command === "sources-list") return { items: store.listSources().map(({ markdown, ...source }) => ({ ...source, characters: [...markdown].length })) };
  if (command === "source-get") return store.getSource(input.id);
  if (command === "wiki-events") return { items: store.events() };
  if (command === "wiki-proposals") return { items: store.listProposals().filter(record => record.kind === "proposal") };
  if (command === "wiki-proposal") {
    const record = store.getProposal(input.id);
    if (record.kind !== "proposal") fail("outside_scope", "此归档记录不是整理提案。");
    return record;
  }
  if (command === "wiki-card") {
    const card = await document(input.id);
    return { id: card.id, revision: card.revision, question: headingQuestion(card.markdown) };
  }
  if (Object.keys(input).some(key => !["sourceId", "cardId"].includes(key)) ||
      (input.cardId !== undefined && (typeof input.cardId !== "string" || !input.cardId)))
    fail("invalid_input", "草稿只接受一份来源和可选的一张已有卡。");
  const source = store.getSource(input.sourceId);
  const target = input.cardId === undefined ? null : await document(input.cardId);
  if (target && !target.editable) fail("unsupported_structure", "这张卡片暂不支持整篇编辑，请生成新卡草稿；旧内容保持只读。");
  return generateWikiDraft({ source, target, complete, signal });
}
