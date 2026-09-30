import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { openRegistry } from "../server/registry.mjs";

const actor = "curated-knowledge-import";
const sharedFields = ["interaction_type", "epistemic_type", "domains", "intents"];
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const unique = (values) => [...new Set(values)];

// Includes existing data and assets, so a concurrent edit anywhere aborts publication.
function fingerprint(db) {
  const hash = createHash("sha256");
  const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
  for (const { name, sql } of tables) {
    hash.update(JSON.stringify([name, sql]));
    const identifier = `"${name.replaceAll('"', '""')}"`;
    for (const row of db.prepare(`SELECT * FROM ${identifier} ORDER BY rowid`).all()) hash.update(JSON.stringify(row));
  }
  return hash.digest("hex");
}

function readManifest(input) {
  const manifest = JSON.parse(readFileSync(input, "utf8"));
  if (!Array.isArray(manifest.items) || !manifest.items.length || manifest.count !== manifest.items.length) throw new Error("Manifest count must match nonempty items");
  const ids = manifest.items.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate Concept ID in manifest");
  for (const item of manifest.items) {
    if (item.lifecycle_status && item.lifecycle_status !== "active") throw new Error(`${item.id}: only active content can be imported`);
    for (const locale of ["cn", "en"]) {
      const local = item.locales?.[locale];
      for (const field of ["name", "description", "source_text", "article_body", "agent_instruction"]) {
        if (typeof local?.[field] !== "string" || !local[field].trim()) throw new Error(`${item.id}/${locale}: missing ${field}`);
      }
      for (const field of ["trigger", "questions", "examples", "avoid_when", "transform", "tags"]) {
        if (!Array.isArray(local[field]) || !local[field].length || local[field].some((value) => typeof value !== "string" || !value.trim())) throw new Error(`${item.id}/${locale}: missing ${field}`);
      }
      if (/示例出处|example source:|请替换|placeholder/i.test(local.source_text)) throw new Error(`${item.id}/${locale}: placeholder source`);
      if (local.cover_image || local.cover_images?.length) throw new Error(`${item.id}: new media requires a separate asset import`);
    }
  }
  if (manifest.relations !== undefined && !Array.isArray(manifest.relations)) throw new Error("relations must be an array");
  return manifest;
}

function createInput(item) {
  const { lifecycle_status, ...input } = structuredClone(item);
  for (const locale of ["cn", "en"]) delete input.locales[locale].cover_images;
  return input;
}

function updateInput(current, item) {
  const changes = Object.fromEntries(sharedFields.map((field) => [field, item[field]]));
  for (const locale of ["cn", "en"]) {
    const previous = current.locales[locale];
    for (const [field, value] of Object.entries(item.locales[locale])) {
      if (["cover_image", "cover_images"].includes(field)) continue;
      let next = value;
      if (field === "aliases") next = unique([...previous.aliases, ...(previous.name !== item.locales[locale].name ? [previous.name] : []), ...value]);
      if (field === "tags") next = unique([...previous.tags, ...value]);
      if (field === "source_text" && previous.article_body) {
        const retained = unique(previous.source_text.match(/https:\/\/[^\s<>"，。；）)]+/g) ?? []).filter((url) => !value.includes(url));
        if (retained.length) next = `${value}\n\n${locale === "cn" ? "既有文章来源" : "Existing article sources"}: ${retained.join(" ")}`;
      }
      if (field === "article_body" && previous[field] && previous[field] !== value) {
        const heading = locale === "cn" ? "## 核实补充：定义、应用与边界" : "## Researched supplement: definition, use and limits";
        const suffix = `\n\n---\n\n${heading}\n\n${value}`;
        if (previous[field].endsWith(suffix)) next = previous[field];
        else if (previous[field].includes(heading)) throw new Error(`${item.id}/${locale}: an earlier supplement differs; review it before replacing`);
        else next = previous[field] + suffix;
      }
      changes[`locales.${locale}.${field}`] = next;
    }
  }
  return { expected_version: current.version, changes };
}

export function importCuratedKnowledge({ db, input, apply = false }) {
  db = resolve(db);
  if (!existsSync(db)) throw new Error(`Database does not exist: ${db}`);
  const manifest = readManifest(input);
  const temp = mkdtempSync(join(tmpdir(), "curated-knowledge-"));
  const stagePath = join(temp, "stage.sqlite");
  let registry;
  try {
    const original = new DatabaseSync(db, { readOnly: true });
    try { original.exec(`VACUUM INTO ${quote(stagePath)}`); } finally { original.close(); }
    const snapshot = new DatabaseSync(stagePath, { readOnly: true });
    let baseline, lastRevision, lastRelation;
    try {
      baseline = fingerprint(snapshot);
      lastRevision = snapshot.prepare("SELECT coalesce(max(revision_id), 0) AS n FROM revisions").get().n;
      lastRelation = snapshot.prepare("SELECT coalesce(max(id), 0) AS n FROM concept_relations").get().n;
    } finally { snapshot.close(); }
    registry = openRegistry(stagePath);
    const existing = new Map(registry.query().map((item) => [item.id, item]));
    const summary = [];
    for (const item of manifest.items) {
      const previous = existing.get(item.id);
      if (previous?.lifecycle_status === "archived") throw new Error(`${item.id}: archived Concept needs explicit restoration`);
      const next = previous ? registry.update(item.id, updateInput(previous, item), actor) : registry.create(createInput(item), actor);
      if (!["cn", "en"].every((locale) => next.readiness[locale].recommendable)) throw new Error(`${item.id}: both locales must be recommendable`);
      summary.push({ id: item.id, action: previous ? next.version === previous.version ? "skip" : "update" : "create", version: next.version });
    }
    const seenRelations = new Set();
    const relationKey = (relation) => {
      const endpoints = [relation.source_concept_id, relation.target_concept_id];
      if (["related_to", "often_used_with", "contrasts_with"].includes(relation.relation_type)) endpoints.sort();
      return JSON.stringify([...endpoints, relation.relation_type]);
    };
    for (const relation of registry.relationsForCandidates(registry.query().map(({ id }) => id))) seenRelations.add(relationKey(relation));
    let relationsAdded = 0;
    for (const relation of manifest.relations ?? []) {
      if (!manifest.items.some(({ id }) => [relation.source_concept_id, relation.target_concept_id].includes(id))) throw new Error("Relation must involve selected content");
      const key = relationKey(relation);
      if (seenRelations.has(key)) continue;
      registry.createRelation(relation);
      seenRelations.add(key);
      relationsAdded++;
    }
    registry.close(); registry = undefined;
    const changed = summary.filter(({ action }) => action !== "skip");
    if (!apply || (!changed.length && !relationsAdded)) return { dryRun: !apply, summary, relationsAdded, backup: null };

    const backup = join(dirname(db), "backups", `knowledge-before-import-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.sqlite`);
    mkdirSync(dirname(backup), { recursive: true });
    const live = new DatabaseSync(db);
    const staged = new DatabaseSync(stagePath, { readOnly: true });
    try {
      live.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000");
      live.exec(`VACUUM INTO ${quote(backup)}`);
      live.exec("BEGIN IMMEDIATE");
      try {
        if (fingerprint(live) !== baseline) throw new Error("Database changed during preparation; no changes published, rerun the preview");
        for (const { id, action } of changed) {
          const row = staged.prepare("SELECT * FROM concepts WHERE id = ?").get(id);
          if (action === "create") live.prepare("INSERT INTO concepts (id, data, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(row.id, row.data, row.version, row.created_at, row.updated_at);
          else live.prepare("UPDATE concepts SET data = ?, version = ?, updated_at = ? WHERE id = ?").run(row.data, row.version, row.updated_at, row.id);
        }
        for (const row of staged.prepare("SELECT * FROM revisions WHERE revision_id > ? ORDER BY revision_id").all(lastRevision)) live.prepare("INSERT INTO revisions (concept_id, version_before, version_after, actor, operation, changed_at, changes) VALUES (?, ?, ?, ?, ?, ?, ?)").run(row.concept_id, row.version_before, row.version_after, row.actor, row.operation, row.changed_at, row.changes);
        for (const row of staged.prepare("SELECT * FROM concept_relations WHERE id > ? ORDER BY id").all(lastRelation)) live.prepare("INSERT INTO concept_relations (source_concept_id, target_concept_id, relation_type, note_cn, note_en, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(row.source_concept_id, row.target_concept_id, row.relation_type, row.note_cn, row.note_en, row.version, row.created_at, row.updated_at);
        if (live.prepare("PRAGMA foreign_key_check").all().length || live.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("Database integrity check failed");
        live.exec("COMMIT");
      } catch (error) { live.exec("ROLLBACK"); throw error; }
    } finally { staged.close(); live.close(); }
    return { dryRun: false, summary, relationsAdded, backup };
  } finally { registry?.close(); rmSync(temp, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = { apply: false };
    for (let i = 2; i < process.argv.length; i++) {
      const flag = process.argv[i];
      if (flag === "--apply") options.apply = true;
      else if (["--db", "--input"].includes(flag) && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) options[flag.slice(2)] = process.argv[++i];
      else throw new Error(`Unknown or incomplete argument: ${flag}`);
    }
    if (!options.db || !options.input) throw new Error("Usage: node scripts/import-curated-knowledge.mjs --db <existing.sqlite> --input <completed.json> [--apply]");
    console.log(JSON.stringify(importCuratedKnowledge(options), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
