import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openRegistry } from "../server/registry.mjs";

const fail = (message) => { throw new Error(message); };
const parse = (path) => JSON.parse(readFileSync(path, "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
function assertIncluded(stored, expected, path) {
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    for (const [key, value] of Object.entries(expected)) assertIncluded(stored?.[key], value, `${path}.${key}`);
  } else if (JSON.stringify(stored) !== JSON.stringify(expected)) fail(`Stored field differs for ${path}`);
}

export function verifyKnowledgeInputs(sourcePath, preparedPath, reportPath) {
  const sourceBytes = readFileSync(sourcePath);
  const source = JSON.parse(sourceBytes);
  const prepared = parse(preparedPath);
  const report = parse(reportPath);
  const hash = sha256(sourceBytes);
  if (hash !== prepared.source_sha256 || hash !== report.source_sha256) fail("Source SHA-256 does not match import evidence");
  if (!Array.isArray(source.items) || !Array.isArray(prepared.items) || source.count !== source.items.length || prepared.count !== prepared.items.length || source.items.length !== prepared.items.length) fail("Concept counts disagree");
  if (!Array.isArray(report.changes) || report.changed_fields !== report.changes.length) fail("Cleanup report count disagrees");
  const sourceIds = source.items.map((item) => item.id);
  if (new Set(sourceIds).size !== sourceIds.length || sourceIds.some((id, i) => id !== prepared.items[i]?.id)) fail("Concept IDs are duplicated or reordered");
  const expected = structuredClone(source.items);
  for (const item of expected) delete item.lifecycle_status;
  const changes = new Set();
  for (const change of report.changes) {
    const { concept_id: id, locale, field, before, after, reason } = change;
    const key = `${id}/${locale}`;
    if (changes.has(key) || !["cn", "en"].includes(locale) || field !== `locales.${locale}.source_text` || reason !== "explicit_replace_me_placeholder" || typeof before !== "string" || before.length === 0 || after !== "") fail("Invalid cleanup change");
    changes.add(key);
    const item = expected.find((candidate) => candidate.id === id);
    if (!item || item.locales?.[locale]?.source_text !== before) fail(`Cleanup before value disagrees for ${key}`);
    item.locales[locale].source_text = after;
  }
  if (new Set(report.changes.map((change) => change.concept_id)).size !== report.affected_concepts) fail("Affected Concept count disagrees");
  for (let i = 0; i < expected.length; i++) if (JSON.stringify(expected[i]) !== JSON.stringify(prepared.items[i])) fail(`Unreported prepared change for ${sourceIds[i]}`);
  return { items: prepared.items, source_sha256: hash, cleared_source_fields: changes.size };
}

export function importKnowledgeList({ sourcePath, preparedPath, reportPath, dbPath }) {
  if (![sourcePath, preparedPath, reportPath, dbPath].every((path) => typeof path === "string" && path)) fail("source, prepared, report, and db paths are required");
  const { items, source_sha256, cleared_source_fields } = verifyKnowledgeInputs(sourcePath, preparedPath, reportPath);
  const database = resolve(dbPath);
  if ([database, `${database}-wal`, `${database}-shm`].some(existsSync)) fail("Database path already exists");
  let registry;
  let reserved = false;
  try {
    // Reserve the path exclusively so a mistaken rerun cannot overwrite a catalog.
    mkdirSync(dirname(database), { recursive: true });
    closeSync(openSync(database, "wx"));
    reserved = true;
    registry = openRegistry(database);
    for (const item of items) registry.previewCreate(item);
    for (const item of items) registry.create(item, "knowledge-import");
    const dashboard = registry.dashboard();
    const both_locales_recommendable = registry.list().filter((item) => item.readiness.cn.recommendable && item.readiness.en.recommendable).length;
    for (const item of items) {
      const stored = registry.get(item.id);
      assertIncluded(stored, item, item.id);
      if (stored.version !== 1 || registry.revisions(item.id).length !== 1) fail(`Revision differs for ${item.id}`);
    }
    return { db_path: database, source_sha256, imported: items.length, cleared_source_fields, active: dashboard.active_total, recommendable: { cn: dashboard.locales.cn.recommendable, en: dashboard.locales.en.recommendable, both: both_locales_recommendable }, usage_runs: dashboard.usage.runs_total };
  } catch (error) {
    if (registry) { registry.close(); registry = null; }
    if (reserved) for (const path of [database, `${database}-wal`, `${database}-shm`]) rmSync(path, { force: true });
    throw error;
  } finally {
    registry?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = Object.fromEntries(process.argv.slice(2).map((part, index, parts) => part.startsWith("--") ? [part.slice(2), parts[index + 1]] : []).filter((entry) => entry.length));
    console.log(JSON.stringify(importKnowledgeList({ sourcePath: args.source, preparedPath: args.prepared, reportPath: args.report, dbPath: args.db }), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
