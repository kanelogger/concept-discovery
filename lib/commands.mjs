import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Compact } from "./compact.mjs";
import { Knowledge } from "./knowledge.mjs";
import { Documents } from "./documents.mjs";
import { fail, save } from "./siyuan.mjs";
import { polishDescription } from "./polish-description.mjs";
import { ask } from "./ask.mjs";

export const commands = new Set(["list", "get-document", "save-document", "delete-document", "search", "ask", "polish-description", "get", "create", "update-block", "append", "recover", "operation-status"]);
function publicLinks(value, origin, publicUrl) {
  if (Array.isArray(value)) return value.map((entry) => publicLinks(entry, origin, publicUrl));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
    key === "url" && typeof entry === "string" && entry.startsWith(origin + "/")
      ? (publicUrl ?? "").replace(/\/$/, "") + entry.slice(origin.length)
      : publicLinks(entry, origin, publicUrl),
  ]));
}

export async function execute(api, command, input = {}, { publicUrl = "", complete, signal } = {}) {
  if (!commands.has(command)) fail("invalid_command", "Unsupported knowledge command");
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("invalid_input", "A JSON object is required");
  if (command === "polish-description") return polishDescription(input, { complete, signal });
  if (command === "ask") return ask(api, input, { publicUrl, complete, signal });
  const knowledge = new Knowledge(api), compact = new Compact(knowledge), documents = new Documents(api, knowledge, publicUrl);
  await api.identity();
  const validateEditable = async (block) => {
    const root = (await api.target(block)).root_id;
    const attrs = await api.attrs(root);
    const card = await knowledge.get(attrs["custom-cd-kind"] === "article" ? attrs["custom-cd-parent"] : root);
    if (!card.sections.some((section) => section.id === block)) fail("outside_scope", "Block is not a current editable field or reading block");
  };
  let result;
  if (command === "list") result = await documents.list(input);
  else if (command === "get-document") result = await documents.get(input.id);
  else if (command === "save-document") result = await documents.save(input);
  else if (command === "delete-document") result = await documents.delete(input);
  else if (command === "search") result = await knowledge.search(input);
  else if (command === "get") result = await knowledge.get(input.id);
  else if (command === "create") result = input.document ? await documents.create(input) : await knowledge.create(input);
  else if (command === "update-block") { await validateEditable(input.id); result = await api.update(input); }
  else if (command === "append") result = await compact.append(input);
  else if (command === "recover") {
    const backup = (await api.receipt(input.backup_op_id)).value;
    if (backup?.command === "delete-document") result = await documents.restoreDeleted(input, backup);
    else if (["save-document", "recover-document"].includes(backup?.command)) result = await documents.recover(input, backup);
    else if (backup?.command === "append") result = await compact.recover(input, backup);
    else { if (backup?.blockId) await validateEditable(backup.blockId); result = await api.recover(input); }
  } else if (command === "operation-status") {
    const entry = await api.receipt(input.op_id), rec = entry.value;
    if (!rec || rec.target !== await api.identity()) fail("operation_conflict", "Operation does not belong to this library");
    if (["unknown", "prepared"].includes(rec.state) && !existsSync(resolve(api.c.dataDir, "write.lock"))) {
      const persist = () => save(entry.p, rec);
      try {
        if (rec.command === "append") rec.result = await compact.confirmAppend(rec, persist);
        else if (rec.command === "recover-append") rec.result = await compact.confirmRecovery(rec, persist);
        else if (rec.command === "save-document") rec.result = await documents.confirmSave(rec, persist);
        else if (rec.command === "recover-document") rec.result = await documents.confirmRecovery(rec, persist);
        else if (["delete-document", "recover-deleted-document"].includes(rec.command)) rec.result = await documents.confirmDeletion(rec, persist);
        else if (rec.command === "create-document" && rec.documentId) {
          rec.result = await documents.confirmCreation(rec);
        }
        if (rec.result) { rec.state = "verified"; persist(); }
      } catch (error) {
        if (!["operation_pending", "outside_scope", "transport_unknown"].includes(error.code)) throw error;
      }
    }
    result = await api.operationStatus(input);
    if (rec.recoveryRevision && result.state === "unknown") result.recovery_revision = rec.recoveryRevision;
  }
  return publicLinks(result, api.origin, publicUrl);
}
