// A recovery witness is recorded by the writer, while it still owns the lock.
// The after* fields in historical receipts can also come from a later query.
export const isDocumentOperation = command =>
  ["save-document", "raw-convert-document", "recover-document"].includes(command);

export function hasWriteWitness(record) {
  return typeof record?.recoveryRevision === "string" && record.recoveryRevision.length > 0 &&
    typeof record.recoverySignature === "string" && record.recoverySignature.length > 0;
}

export function matchesWriteWitness(record, snapshot) {
  return hasWriteWitness(record) && record.recoveryRevision === snapshot.revision &&
    record.recoverySignature === snapshot.signature;
}

// Old successful restores checked the complete frozen native tree before they
// published a revision. That tree is also available to check before an undo.
export function hasFrozenRecoveryResult(record) {
  const target = record.restoreDocument;
  return record.command === "recover-document" && record.state === "verified" && !record.afterSignature &&
    typeof record.documentId === "string" && record.result?.id === record.documentId && record.afterRevision && record.result.revision === record.afterRevision &&
    target?.id === record.documentId && Array.isArray(target.nodes) && target.attrs &&
    typeof target.title === "string" && typeof target.raw === "string";
}

export function isUnprovenDocumentReceipt(record) {
  return isDocumentOperation(record?.command) && record.state === "unknown" &&
    ["unproven_conversion", "unproven_document_write"].includes(record.error?.code);
}

export function documentReceiptView(record) {
  if (!record || record.state !== "verified" || !isDocumentOperation(record.command)) return record;
  if (hasFrozenRecoveryResult(record)) return record;
  if (hasWriteWitness(record) && record.afterRevision === record.recoveryRevision &&
      record.afterSignature === record.recoverySignature && record.result?.revision === record.afterRevision &&
      record.result.id === record.documentId) return record;

  const {result, afterRevision, afterHash, afterSignature, ...original} = record;
  const code = record.command === "raw-convert-document" ? "unproven_conversion" : "unproven_document_write";
  return {...original, state:"unknown", error:{
    code, message:"回执缺少可核实的原写入版本或原生块签名。请核对原操作、当前文档及备份。"
  }};
}
