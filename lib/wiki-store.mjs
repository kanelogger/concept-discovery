import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync,
  writeFileSync, unlinkSync, linkSync, realpathSync,
} from "node:fs";
import { resolve, join, relative, isAbsolute } from "node:path";
import { randomBytes } from "node:crypto";
import { canonical, fail, hash } from "./siyuan.mjs";

export const sourceSnapshotCharLimit = 200000;
export const sourceSnapshotByteLimit = 1024 * 1024;
const suffix = "(?:[a-f0-9]{16,64}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})";
const identifiers = Object.fromEntries(["src", "prop", "evt"].map(prefix => [prefix, new RegExp(`^${prefix}_${suffix}$`)]));
const object = value => value && typeof value === "object" && !Array.isArray(value);
const digest = value => hash(canonical(value));
export function sourceSnapshotId({sourceId, title, markdown, url, author}) {
  return "src_" + digest({sourceId, title, markdown, url, author}).slice(0, 32);
}

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

export function validateSourceSnapshot(source) {
  if (!object(source) || !identifiers.src.test(source.id ?? "") || !identifiers.src.test(source.sourceId ?? "") ||
      !Number.isSafeInteger(source.version) || source.version < 1 ||
      typeof source.markdown !== "string" || !source.markdown.trim() || source.markdown.includes("\0") ||
      [...source.markdown].length > sourceSnapshotCharLimit || Buffer.byteLength(source.markdown) > sourceSnapshotByteLimit ||
      source.hash !== hash(source.markdown) || source.id !== sourceSnapshotId(source) ||
      typeof source.createdAt !== "string" || !Number.isFinite(Date.parse(source.createdAt)))
    fail("invalid_input", "原始资料的标识、版本或内容校验失败。");
  text(source.title, 1000, "资料标题");
  text(source.author, 500, "作者", {optional: true});
  metadataURL(source.url);
}
function openDirectory(path, readOnly) {
  if (!readOnly) mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return null;
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("outside_scope", "私有资料目录无效。");
  return realpathSync(path);
}
function readJSON(path) {
  if (!path || !existsSync(path)) fail("not_found", "资料或提案不存在。");
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
export function createWikiStore(root, libraryId, { readOnly = false } = {}) {
  if (typeof root !== "string" || !root || typeof libraryId !== "string" || !libraryId.trim())
    fail("configuration", "知识整理存储需要私有目录和知识库标识。");
  const configuredRoot = openDirectory(resolve(root), readOnly);
  const base = configuredRoot && openDirectory(join(configuredRoot, digest(libraryId)), readOnly);
  const areas = Object.fromEntries(["sources", "proposals", "events"].map(area => {
    const directory = base && openDirectory(join(base, area), readOnly);
    if (!directory) return [area, null];
    const path = relative(base, directory);
    if (path.startsWith("..") || isAbsolute(path)) fail("outside_scope", "资料目录越出当前知识库。");
    return [area, directory];
  }));
  const pathFor = (area, id, prefix) => {
    const name = identifier(id, prefix) + ".json";
    return areas[area] && join(areas[area], name);
  };
  const files = (area, prefix) => (areas[area] ? readdirSync(areas[area]) : [])
    .filter(name => name.endsWith(".json") && identifiers[prefix].test(name.slice(0, -5)))
    .map(name => name.slice(0, -5));
  const getSource = id => {
    const envelope = readJSON(pathFor("sources", id, "src"));
    const source = envelope?.record;
    if (!object(source) || source.id !== id || !identifiers.src.test(source.sourceId ?? "") ||
        !Number.isSafeInteger(source.version) || source.version < 1 ||
        typeof source.markdown !== "string" || source.hash !== hash(source.markdown) ||
        source.id !== sourceSnapshotId(source) || envelope.recordHash !== digest(source))
      fail("content_conflict", "原始资料快照校验失败，不能将其用于整理。");
    return source;
  };
  const listSources = () => files("sources", "src").map(getSource)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.version - a.version || a.id.localeCompare(b.id));
  const getProposal = id => {
    const value = readJSON(pathFor("proposals", id, "prop"));
    if (!object(value) || value.id !== id) fail("content_conflict", "提案内容无法核对。");
    const { revision, ...record } = value;
    if (revision !== digest(record)) fail("content_conflict", "提案版本校验失败，请重新读取。");
    return value;
  };
  const getEvent = id => {
    const envelope = readJSON(pathFor("events", id, "evt"));
    if (!object(envelope?.record) || envelope.record.id !== id || envelope.recordHash !== digest(envelope.record))
      fail("content_conflict", "知识记录无法核对。");
    return envelope.record;
  };

  const reader = {
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
  if (readOnly) return reader;
  return {
    ...reader,
    // Local archive restore. Verify the immutable identity before publishing the
    // file, and never replace a snapshot that already exists on this target.
    restoreSource(source) {
      validateSourceSnapshot(source);
      const file = pathFor("sources", source.id, "src");
      if (!existsSync(file)) {
        try { persist(file, {record: source, recordHash: digest(source)}); }
        catch (e) { if (e.code !== "EEXIST") throw e; }
      }
      const saved = getSource(source.id);
      if (digest(saved) !== digest(source)) fail("content_conflict", "已有快照与原稿记录不一致。");
      return saved;
    },
  };
}
