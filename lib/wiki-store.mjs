import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync,
  writeFileSync, unlinkSync, linkSync, realpathSync,
} from "node:fs";
import { resolve, join, relative, isAbsolute } from "node:path";
import { randomBytes } from "node:crypto";
import { canonical, fail, hash } from "./siyuan.mjs";

export const sourceImportLimit = 200000;
export const sourceImportBytes = 1024 * 1024;
const suffix = "(?:[a-f0-9]{16,64}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})";
const identifiers = Object.fromEntries(["src", "prop", "evt"].map(prefix => [prefix, new RegExp(`^${prefix}_${suffix}$`)]));
const object = value => value && typeof value === "object" && !Array.isArray(value);
const now = () => new Date().toISOString();
const digest = value => hash(canonical(value));
const clone = value => JSON.parse(JSON.stringify(value));

function identifier(value, prefix) {
  if (typeof value !== "string" || !identifiers[prefix].test(value))
    fail("invalid_input", "资料或提案标识无效。");
  return value;
}
function text(value, max, label, { optional = false } = {}) {
  if (optional && value === undefined) return "";
  if (typeof value !== "string" || [...value].length > max || value.includes("\0") || (!optional && !value.trim()))
    fail("invalid_input", `${label}为空、过长或包含无效字符。`);
  return value.trim();
}
function metadataURL(value) {
  const result = text(value, 2000, "来源地址", { optional: true });
  if (!result) return "";
  try {
    const url = new URL(result);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.href;
  } catch { fail("invalid_input", "来源地址需要是不含凭据的HTTP或HTTPS链接。"); }
}
function ensureDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("outside_scope", "私有资料目录无效。");
}
function readJSON(path) {
  if (!existsSync(path)) fail("not_found", "资料或提案不存在。");
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("outside_scope", "资料文件不在允许范围内。");
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { fail("content_conflict", "资料文件无法核对，请保留现场后检查。"); }
}
function persist(path, value) {
  let serialized;
  try { serialized = JSON.stringify(value, null, 2) + "\n"; }
  catch { fail("invalid_input", "内容必须可保存为JSON。"); }
  if (Buffer.byteLength(serialized) > 8 * 1024 * 1024) fail("invalid_input", "提案或记录超过保存上限。");
  const temporary = path + ".tmp-" + randomBytes(12).toString("hex");
  writeFileSync(temporary, serialized, { mode: 0o600, flag: "wx" });
  try {
    linkSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

/** Private application metadata, isolated by the owning knowledge library. */
export function createWikiStore(root, libraryId) {
  if (typeof root !== "string" || !root || typeof libraryId !== "string" || !libraryId.trim())
    fail("configuration", "知识整理存储需要私有目录和知识库标识。");
  const configuredRoot = resolve(root);
  ensureDirectory(configuredRoot);
  const base = join(realpathSync(configuredRoot), digest(libraryId));
  ensureDirectory(base);
  const areas = Object.fromEntries(["sources", "proposals", "events", "imports"].map(area => {
    const directory = join(base, area);
    ensureDirectory(directory);
    const path = relative(base, realpathSync(directory));
    if (path.startsWith("..") || isAbsolute(path)) fail("outside_scope", "资料目录越出当前知识库。");
    return [area, directory];
  }));
  const pathFor = (area, id, prefix) => join(areas[area], identifier(id, prefix) + ".json");
  const files = (area, prefix) => readdirSync(areas[area])
    .filter(name => name.endsWith(".json") && identifiers[prefix].test(name.slice(0, -5)))
    .map(name => name.slice(0, -5));
  const snapshotKey = source => digest({ sourceId: source.sourceId, title: source.title,
    markdown: source.markdown, url: source.url, author: source.author });
  const getSource = id => {
    const envelope = readJSON(pathFor("sources", id, "src"));
    const source = envelope?.record;
    if (!object(source) || source.id !== id || !identifiers.src.test(source.sourceId ?? "") ||
        !Number.isSafeInteger(source.version) || source.version < 1 ||
        typeof source.markdown !== "string" || source.hash !== hash(source.markdown) ||
        source.id !== "src_" + snapshotKey(source).slice(0, 32) || envelope.recordHash !== digest(source))
      fail("content_conflict", "原始资料快照校验失败，不能将其用于整理。");
    return clone(source);
  };
  const listSources = () => files("sources", "src").map(getSource)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.version - a.version || a.id.localeCompare(b.id));
  const getProposal = id => {
    const value = readJSON(pathFor("proposals", id, "prop"));
    if (!object(value) || value.id !== id) fail("content_conflict", "提案内容无法核对。");
    const { revision, ...record } = value;
    if (revision !== digest(record)) fail("content_conflict", "提案版本校验失败，请重新读取。");
    return clone(value);
  };
  const getEvent = id => {
    const envelope = readJSON(pathFor("events", id, "evt"));
    if (!object(envelope?.record) || envelope.record.id !== id || envelope.recordHash !== digest(envelope.record))
      fail("content_conflict", "知识记录无法核对。");
    return clone(envelope.record);
  };

  return {
    importSource(input) {
      if (!object(input) || typeof input.op_id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.op_id))
        fail("invalid_input", "导入需要有效的操作ID。");
      if (Object.keys(input).some(key => !["op_id", "title", "markdown", "url", "author"].includes(key)))
        fail("invalid_input", "每次导入保存独立快照，不再接受来源版本或其他字段。");
      const title = text(input.title, 1000, "资料标题");
      if (typeof input.markdown !== "string" || !input.markdown.trim() || input.markdown.includes("\0") ||
          [...input.markdown].length > sourceImportLimit || Buffer.byteLength(input.markdown) > sourceImportBytes)
        fail("invalid_input", `原文须为非空文本，最多${sourceImportLimit}字符且不超过1MiB；内容不会被自动截断。`);
      const payload = { title, markdown: input.markdown, url: metadataURL(input.url),
        author: text(input.author, 500, "作者", { optional: true }), sourceId: null };
      const requestHash = digest(payload);
      const operation = join(areas.imports, digest(input.op_id) + ".json");
      let receipt;
      if (existsSync(operation)) {
        receipt = readJSON(operation);
        if (receipt.requestHash !== requestHash) fail("operation_conflict", "此操作ID已用于其他资料，请先核对原导入结果。");
        if (existsSync(pathFor("sources", receipt.id, "src"))) return getSource(receipt.id);
      }
      // An operation identifies one independent import. Existing receipts still
      // resolve their historical version; new imports never extend a source family.
      const sourceId = receipt?.sourceId ?? "src_" + digest({ op_id: input.op_id }).slice(0, 32);
      const record = { sourceId, title, markdown: payload.markdown, url: payload.url, author: payload.author };
      const id = "src_" + snapshotKey(record).slice(0, 32);
      if (receipt && receipt.id !== id) fail("content_conflict", "导入回执与原始资料无法核对。");
      const source = { id, ...record, version: receipt?.version ?? 1,
        hash: hash(record.markdown), createdAt: receipt?.createdAt ?? now() };
      const file = pathFor("sources", id, "src");
      if (!receipt) persist(operation, { requestHash, id, sourceId, version: source.version, createdAt: source.createdAt });
      if (!existsSync(file)) persist(file, { record: source, recordHash: digest(source) });
      return getSource(id);
    },
    listSources,
    getSource,
    listProposals() {
      return files("proposals", "prop").map(getProposal)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    },
    getProposal,
    events() {
      return files("events", "evt").map(getEvent)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    },
  };
}
