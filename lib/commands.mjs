import { hasWriteWitness, isDocumentOperation, isUnprovenDocumentReceipt } from "./document-receipt.mjs";
import { Compact } from "./compact.mjs";
import { Knowledge } from "./knowledge.mjs";
import { Documents } from "./documents.mjs";
import { canonical, fail, hash, normalize } from "./siyuan.mjs";

export const commands = new Set(["list", "get-document", "save-document", "delete-document", "search", "get", "update-block", "recover", "operation-status"]);
function publicLinks(value, origin, publicUrl) {
  if (Array.isArray(value)) return value.map((entry) => publicLinks(entry, origin, publicUrl));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
    key === "url" && typeof entry === "string" && entry.startsWith(origin + "/")
      ? (publicUrl ?? "").replace(/\/$/, "") + entry.slice(origin.length)
      : publicLinks(entry, origin, publicUrl),
  ]));
}

export async function execute(api, command, input = {}, { publicUrl = "", signal, cardBodies, retryRecovery = false, recoveryOptions } = {}) {
  if (!commands.has(command)) fail("invalid_command", "Unsupported knowledge command");
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("invalid_input", "A JSON object is required");
  const deprecated = new Set(["locale", "locales", "language", "chineseArticleId"]);
  const hasLanguageOption = value => value && typeof value === "object" &&
    (Object.keys(value).some(key => deprecated.has(key)) || Object.values(value).some(hasLanguageOption));
  if (hasLanguageOption(input) || input.concept !== undefined)
    fail("invalid_input", "Language options and fixed-field concept inputs are no longer supported");
  const knowledge = new Knowledge(api), compact = new Compact(knowledge), documents = new Documents(api, knowledge, publicUrl);
  if (command === "list") {
    signal?.throwIfAborted();
    await api.identity({ signal });
    return documents.list(input, { signal, cardBodies });
  }
  const target = await api.identity({signal});
  signal?.throwIfAborted();
  const validateEditable = async (block) => {
    const root = (await api.target(block)).root_id;
    const attrs = await api.attrs(root);
    const card = await knowledge.get(attrs["custom-cd-kind"] === "article" ? attrs["custom-cd-parent"] : root);
    if (!card.sections.some((section) => section.id === block)) fail("outside_scope", "Block is not a current editable field or reading block");
  };
  let result;
  if (command === "get-document") result = await documents.get(input.id);
  else if (command === "save-document") result = await documents.save(input);
  else if (command === "delete-document") result = await documents.delete(input);
  else if (command === "search") result = await knowledge.search(input);
  else if (command === "get") result = await knowledge.get(input.id);
  else if (command === "update-block") { await validateEditable(input.id); result = await api.update(input); }
  else if (command === "recover") {
    const backup = (await api.receipt(input.backup_op_id)).value;
    const retryOptions = recoveryOptions ?? (retryRecovery ? {retryRecovery} : undefined);
    if (backup?.command === "delete-document") result = await documents.restoreDeleted(input, backup, retryOptions);
    else if (["save-document", "recover-document", "raw-convert-document"].includes(backup?.command)) result = await documents.recover(input, backup, retryOptions);
    else if (backup?.command === "append") result = await compact.recover(input, backup, retryOptions);
    else { if (backup?.blockId) await validateEditable(backup.blockId); result = await api.recover(input, retryOptions); }
  } else if (command === "operation-status") {
    const checkTarget = rec => {
      if (!rec || rec.target !== target) fail("operation_conflict", "Operation does not belong to this library");
    };
    let {value: rec} = await api.receipt(input.op_id);
    checkTarget(rec);
    if (canConfirmReceipt(rec)) {
      rec = await api.withReceipt(input.op_id, async (current, publish) => {
        checkTarget(current);
        if (publish) await confirmReceipt(documents, current, () => publish(current), input.op_id);
        return current;
      }, {readWhenBusy: true});
    }
    const hasRecoveryVersion = isDocumentOperation(rec.command)
      ? ["prepared", "unknown"].includes(rec.state) && hasWriteWitness(rec)
      : rec.state === "unknown" && rec.recoveryRevision;
    result = {op_id:input.op_id, state:rec.state, result:rec.result, error:rec.error,
      ...(hasRecoveryVersion && {recovery_revision:rec.recoveryRevision})};
  }
  return publicLinks(result, api.origin, publicUrl);
}

function canConfirmReceipt(rec) {
  if (isUnprovenDocumentReceipt(rec)) return false;
  const pending = ["unknown", "prepared"].includes(rec.state) ||
    (rec.state === "failed" && rec.command === "raw-convert-document");
  return pending && (!isDocumentOperation(rec.command) || (rec.documentId && hasWriteWitness(rec)));
}

// All callers hold the instance write lock and have checked the receipt target.
export async function confirmReceipt(documents, rec, persist, opId = rec.input?.op_id) {
  if (!canConfirmReceipt(rec)) return;
  const api = documents.a, compact = new Compact(documents.k);
  let result;
  if (rec.command === "create" && rec.documentId) {
    try {
      const attrs = await api.attrs(rec.documentId);
      if (attrs["custom-cd-request"] === rec.requestHash && attrs["custom-cd-complete"] === "1")
        result = {id: rec.documentId, op_id: opId};
    } catch { return; }
  } else if (rec.command === "update-block" && rec.blockId) {
    const md = await api.markdown(rec.blockId);
    if (normalize(md) !== normalize(rec.intended)) return;
    rec.after = md; rec.afterHash = hash(md);
    result = {id: rec.blockId, hash: rec.afterHash, markdown: md, op_id: opId};
  } else {
    try {
      if (rec.command === "append") result = await compact.confirmAppend(rec, persist);
      else if (rec.command === "recover-append" && rec.groupId) result = await compact.confirmRecovery(rec, persist);
      else if (["save-document", "raw-convert-document"].includes(rec.command) && rec.documentId) {
        const {command, input, target} = rec;
        if (command === "raw-convert-document" &&
            (input?.id !== rec.documentId || rec.requestHash !== hash(canonical({command, input, target}))))
          fail("operation_conflict", "此操作回执属于其他输入。");
        result = await documents.confirmDocumentWrite(rec, persist);
      } else if (rec.command === "recover-document" && rec.restoreDocument) result = await documents.confirmDocumentWrite(rec, persist);
      else if (["delete-document", "recover-deleted-document"].includes(rec.command)) result = await documents.confirmDeletion(rec, persist);
      else if (rec.command === "create-document" && rec.documentId) result = await documents.confirmCreation(rec);
    } catch (error) {
      if (!["operation_pending", "outside_scope", "transport_unknown"].includes(error.code)) throw error;
    }
  }
  if (result) {
    rec.result = result; rec.state = "verified";
    persist();
  }
}
