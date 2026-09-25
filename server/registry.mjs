import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const interactionTypes = new Set(["operator", "lens", "procedure"]);
const epistemicTypes = new Set(["formal_model", "empirical_finding", "heuristic", "principle", "framework", "law", "bias"]);
const domainCodes = new Set(["reasoning", "communication"]);
const intentCodes = new Set(["simplify", "reduce-complexity"]);
const localeFields = new Set(["name", "aliases", "description", "cover_image", "wiki_url", "tags", "trigger", "avoid_when", "transform", "agent_instruction", "source_text"]);
const listFields = new Set(["aliases", "tags", "trigger", "avoid_when", "transform"]);
const sharedFields = new Set(["interaction_type", "epistemic_type", "domains", "intents"]);
const relationTypes = new Set(["related_to", "often_used_with", "contrasts_with", "extends", "part_of"]);
const symmetricRelations = new Set(["related_to", "often_used_with", "contrasts_with"]);

export class RegistryError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const bad = (message) => { throw new RegistryError(400, "invalid_input", message); };
const emptyLocale = () => ({ name: "", aliases: [], description: "", cover_image: "", wiki_url: "", tags: [], trigger: [], avoid_when: [], transform: [], agent_instruction: "", source_text: "" });
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function text(value, path) {
  if (typeof value !== "string") bad(`${path} must be text`);
  return value.trim();
}

function textList(value, path) {
  if (!Array.isArray(value)) bad(`${path} must be a list`);
  return [...new Set(value.map((item) => text(item, path)).filter(Boolean))];
}

function codeList(value, path, codes) {
  const list = textList(value, path);
  if (list.some((item) => !codes.has(item))) bad(`${path} contains an unknown code`);
  return list;
}

function normalizedField(path, value) {
  if (path === "interaction_type" || path === "epistemic_type") {
    const normalized = value === null ? null : text(value, path) || null;
    if (normalized && !(path === "interaction_type" ? interactionTypes : epistemicTypes).has(normalized)) bad(`${path} is invalid`);
    return normalized;
  }
  if (path === "domains") return codeList(value, path, domainCodes);
  if (path === "intents") return codeList(value, path, intentCodes);
  const parts = path.split(".");
  if (parts.length !== 3 || parts[0] !== "locales" || !["cn", "en"].includes(parts[1]) || !localeFields.has(parts[2])) bad(`${path} is not editable`);
  const field = parts[2];
  if (listFields.has(field)) return textList(value, path);
  const normalized = text(value, path);
  if (field === "cover_image" && normalized) bad("Image upload is not available until ticket 0025");
  if (field === "wiki_url" && normalized) {
    try {
      const url = new URL(normalized);
      if (url.protocol !== "https:" || !url.hostname) bad(`${path} must be an absolute HTTPS URL`);
    } catch { bad(`${path} must be an absolute HTTPS URL`); }
  }
  return normalized;
}

function validateNames(concept) {
  if (!concept.locales.cn.name && !concept.locales.en.name) bad("At least one locale needs a name");
}

function fromInput(input, { requireName = true } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) bad("Concept must be an object");
  if (typeof input.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.id) || input.id.length > 80) bad("ID must be a lowercase slug");
  for (const key of Object.keys(input)) if (!["id", ...sharedFields, "locales"].includes(key)) bad(`${key} is not a Concept field`);
  if (!input.locales || typeof input.locales !== "object" || Array.isArray(input.locales)) bad("locales must be an object");
  for (const key of Object.keys(input.locales)) if (!["cn", "en"].includes(key)) bad(`Unknown locale ${key}`);
  const concept = { id: input.id, lifecycle_status: "active", interaction_type: null, epistemic_type: null, domains: [], intents: [], locales: { cn: emptyLocale(), en: emptyLocale() } };
  for (const field of sharedFields) if (own(input, field)) concept[field] = normalizedField(field, input[field]);
  for (const locale of ["cn", "en"]) {
    const data = input.locales[locale] ?? {};
    if (!data || typeof data !== "object" || Array.isArray(data)) bad(`locales.${locale} must be an object`);
    for (const [field, value] of Object.entries(data)) {
      if (!localeFields.has(field)) bad(`Unknown field locales.${locale}.${field}`);
      concept.locales[locale][field] = normalizedField(`locales.${locale}.${field}`, value);
    }
  }
  if (requireName) validateNames(concept);
  return concept;
}

function readiness(concept, locale) {
  const data = concept.locales[locale];
  const browseMissing = ["name", "description", "source_text"].filter((field) => !data[field]);
  const recommendMissing = [...browseMissing, ...(["cover_image", "trigger", "agent_instruction"].filter((field) => field === "trigger" ? data.trigger.length === 0 : !data[field]))];
  return { browsable: concept.lifecycle_status === "active" && browseMissing.length === 0, recommendable: concept.lifecycle_status === "active" && recommendMissing.length === 0, browse_missing: browseMissing, recommend_missing: recommendMissing };
}

function publicConcept(concept) {
  return { ...concept, readiness: { cn: readiness(concept, "cn"), en: readiness(concept, "en") } };
}

function normalizedRelation(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !["source_concept_id", "target_concept_id", "relation_type", "note"].includes(key))) bad("Invalid Relation fields");
  let { source_concept_id: source, target_concept_id: target, relation_type: type } = input;
  if (typeof source !== "string" || typeof target !== "string" || !source || !target || source === target) bad("Relation needs two different Concept IDs");
  if (!relationTypes.has(type)) bad("relation_type is invalid");
  if (symmetricRelations.has(type) && source > target) [source, target] = [target, source];
  const note = input.note ?? {};
  if (!note || typeof note !== "object" || Array.isArray(note) || Object.keys(note).some((key) => !["cn", "en"].includes(key))) bad("Relation note must have cn/en text");
  for (const locale of ["cn", "en"]) if (note[locale] !== undefined && typeof note[locale] !== "string") bad(`note.${locale} must be text`);
  return { source_concept_id: source, target_concept_id: target, relation_type: type, note: { cn: note.cn?.trim() ?? "", en: note.en?.trim() ?? "" } };
}

function changesBetween(before, after, prefix = "") {
  const changes = [];
  for (const [field, next] of Object.entries(after)) {
    const path = prefix ? `${prefix}.${field}` : field;
    const previous = before?.[field];
    if (next && typeof next === "object" && !Array.isArray(next)) changes.push(...changesBetween(previous, next, path));
    else if (JSON.stringify(previous) !== JSON.stringify(next)) changes.push({ path, before: previous ?? null, after: next });
  }
  return changes;
}

function webpBytes(base64) {
  if (typeof base64 !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) bad("Image data must be base64");
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length < 25 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP" || bytes.readUInt32LE(4) + 8 !== bytes.length) bad("Image is not a valid WebP file");
  let offset = 12;
  const first = bytes.toString("ascii", 12, 16);
  if (!["VP8 ", "VP8L", "VP8X"].includes(first)) bad("Image is not a valid WebP file");
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) bad("Image is not a valid WebP file");
    const length = bytes.readUInt32LE(offset + 4);
    if (offset + 8 + length > bytes.length) bad("Image is not a valid WebP file");
    if (offset === 12) {
      const payload = offset + 8;
      if (first === "VP8 " && (length < 10 || bytes.toString("hex", payload + 3, payload + 6) !== "9d012a")) bad("Image is not a valid WebP file");
      if (first === "VP8L" && (length < 5 || bytes[payload] !== 0x2f)) bad("Image is not a valid WebP file");
      if (first === "VP8X" && length < 10) bad("Image is not a valid WebP file");
    }
    offset += 8 + length + (length % 2);
  }
  if (offset !== bytes.length) bad("Image is not a valid WebP file");
  return bytes;
}

function mediaActions(media) {
  if (media === undefined) return [];
  if (!media || typeof media !== "object" || Array.isArray(media)) bad("media must be an object");
  const result = [];
  for (const [locale, action] of Object.entries(media)) {
    if (!["cn", "en"].includes(locale) || !action || typeof action !== "object" || Array.isArray(action)) bad("Invalid media locale or action");
    if (action.action === "remove" && Object.keys(action).length === 1) result.push({ locale, hash: "", bytes: null });
    else if (action.action === "set" && Object.keys(action).length === 2 && own(action, "data")) {
      const bytes = webpBytes(action.data);
      result.push({ locale, hash: createHash("sha256").update(bytes).digest("hex"), bytes });
    } else bad("Invalid media action");
  }
  return result;
}

export function openRegistry(path = process.env.CONCEPT_DB_PATH || ".local/concept-discovery.sqlite") {
  const dbPath = resolve(path);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; CREATE TABLE IF NOT EXISTS concepts (id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS revisions (revision_id INTEGER PRIMARY KEY AUTOINCREMENT, concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE, version_before INTEGER NOT NULL, version_after INTEGER NOT NULL, actor TEXT NOT NULL, operation TEXT NOT NULL, changed_at TEXT NOT NULL, changes TEXT NOT NULL); CREATE TABLE IF NOT EXISTS media_assets (hash TEXT PRIMARY KEY, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS concept_references (concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE RESTRICT, source_type TEXT NOT NULL, source_id TEXT NOT NULL, PRIMARY KEY (concept_id, source_type, source_id)); CREATE TABLE IF NOT EXISTS concept_relations (id INTEGER PRIMARY KEY AUTOINCREMENT, source_concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE RESTRICT, target_concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE RESTRICT, relation_type TEXT NOT NULL, note_cn TEXT NOT NULL DEFAULT '', note_en TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(source_concept_id, target_concept_id, relation_type), CHECK(source_concept_id <> target_concept_id));");
  const readRow = db.prepare("SELECT data FROM concepts WHERE id = ?");
  const relationRow = db.prepare("SELECT * FROM concept_relations WHERE id = ?");
  const publicRelation = (row) => ({ id: row.id, source_concept_id: row.source_concept_id, target_concept_id: row.target_concept_id, relation_type: row.relation_type, note: { cn: row.note_cn, en: row.note_en }, version: row.version, created_at: row.created_at, updated_at: row.updated_at });
  const getRelation = (id) => {
    if (!Number.isInteger(id) || id < 1) bad("Relation ID must be a positive integer");
    const row = relationRow.get(id);
    if (!row) throw new RegistryError(404, "not_found", "Relation not found");
    return publicRelation(row);
  };
  const get = (id) => {
    const row = readRow.get(id);
    if (!row) throw new RegistryError(404, "not_found", `Concept ${id} not found`);
    return publicConcept(JSON.parse(row.data));
  };
  const prepareUpdate = (id, input) => {
    if (!input || !Number.isInteger(input.expected_version) || !input.changes || typeof input.changes !== "object" || Array.isArray(input.changes)) bad("expected_version and changes are required");
    if (Object.keys(input).some((key) => !["expected_version", "changes", "media"].includes(key))) bad("Unknown update field");
    const previous = get(id);
    if (previous.version !== input.expected_version) throw new RegistryError(409, "version_conflict", "Concept changed; reload before saving");
    const next = structuredClone(previous);
    delete next.readiness;
    const actions = mediaActions(input.media);
    for (const [path, value] of Object.entries(input.changes)) {
      if (path === "id" || path === "lifecycle_status" || path === "version") bad(`${path} is not editable`);
      const normalized = normalizedField(path, value);
      const parts = path.split(".");
      if (parts.length === 1) next[path] = normalized;
      else next.locales[parts[1]][parts[2]] = normalized;
    }
    for (const action of actions) next.locales[action.locale].cover_image = action.hash;
    validateNames(next);
    return { previous, next, actions, changes: changesBetween(previous, next).filter((change) => change.path !== "readiness") };
  };
  const setLifecycle = (id, input, status, actor = "local-user") => {
    if (!input || !Number.isInteger(input.expected_version) || Object.keys(input).some((key) => key !== "expected_version")) bad("expected_version is required");
    const previous = get(id);
    if (previous.version !== input.expected_version) throw new RegistryError(409, "version_conflict", "Concept changed; reload before saving");
    if (previous.lifecycle_status === status) return previous;
    const next = structuredClone(previous);
    delete next.readiness;
    next.lifecycle_status = status;
    next.version += 1;
    next.updated_at = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      const updated = db.prepare("UPDATE concepts SET data = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?").run(JSON.stringify(next), next.version, next.updated_at, id, previous.version);
      if (!updated.changes) throw new RegistryError(409, "version_conflict", "Concept changed; reload before saving");
      db.prepare("INSERT INTO revisions (concept_id, version_before, version_after, actor, operation, changed_at, changes) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, previous.version, next.version, actor, status === "archived" ? "archive" : "restore", next.updated_at, JSON.stringify([{ path: "lifecycle_status", before: previous.lifecycle_status, after: status }]));
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return publicConcept(next);
  };
  const imageHashes = (concept, revisions) => {
    const hashes = new Set([concept.locales.cn.cover_image, concept.locales.en.cover_image]);
    for (const revision of revisions) for (const change of JSON.parse(revision.changes)) {
      if (change.path.endsWith(".cover_image")) { hashes.add(change.before); hashes.add(change.after); }
    }
    hashes.delete(""); hashes.delete(null);
    return hashes;
  };
  return {
    close: () => db.close(),
    get,
    getRelation,
    relationsForCandidates: (conceptIds) => {
      const ids = new Set(conceptIds);
      return db.prepare("SELECT source_concept_id, target_concept_id, relation_type FROM concept_relations ORDER BY id").all()
        .filter((row) => ids.has(row.source_concept_id) && ids.has(row.target_concept_id));
    },
    listRelations: (conceptId, locale) => {
      get(conceptId);
      if (!["cn", "en"].includes(locale)) bad("locale must be cn or en");
      return db.prepare("SELECT * FROM concept_relations WHERE source_concept_id = ? OR target_concept_id = ? ORDER BY id").all(conceptId, conceptId).map((row) => {
        const otherId = row.source_concept_id === conceptId ? row.target_concept_id : row.source_concept_id;
        const otherRow = readRow.get(otherId);
        const other = otherRow ? publicConcept(JSON.parse(otherRow.data)) : null;
        const name = other?.locales[locale].name || null;
        return { id: row.id, source_concept_id: row.source_concept_id, target_concept_id: row.target_concept_id, relation_type: row.relation_type,
          direction: symmetricRelations.has(row.relation_type) ? "symmetric" : row.source_concept_id === conceptId ? "outgoing" : "incoming",
          note: row[`note_${locale}`], version: row.version,
          other: { id: otherId, name, status: other?.lifecycle_status || "missing", browsable: Boolean(other?.readiness[locale].browsable) },
        };
      });
    },
    createRelation: (input) => {
      const relation = normalizedRelation(input);
      for (const id of [relation.source_concept_id, relation.target_concept_id]) if (get(id).lifecycle_status !== "active") throw new RegistryError(409, "archived_concept", "New Relations require active Concepts");
      const now = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        const inserted = db.prepare("INSERT INTO concept_relations (source_concept_id, target_concept_id, relation_type, note_cn, note_en, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)").run(relation.source_concept_id, relation.target_concept_id, relation.relation_type, relation.note.cn, relation.note.en, now, now);
        for (const id of [relation.source_concept_id, relation.target_concept_id]) db.prepare("INSERT INTO concept_references (concept_id, source_type, source_id) VALUES (?, 'relation', ?)").run(id, String(inserted.lastInsertRowid));
        db.exec("COMMIT");
        return getRelation(Number(inserted.lastInsertRowid));
      } catch (error) { db.exec("ROLLBACK"); if (String(error).includes("UNIQUE constraint")) throw new RegistryError(409, "duplicate_relation", "Relation already exists"); throw error; }
    },
    updateRelation: (id, input) => {
      const previous = getRelation(id);
      if (!input || !Number.isInteger(input.expected_version) || !input.changes || typeof input.changes !== "object" || Array.isArray(input.changes) || Object.keys(input).some((key) => !["expected_version", "changes"].includes(key))) bad("expected_version and changes are required");
      if (input.expected_version !== previous.version) throw new RegistryError(409, "version_conflict", "Relation changed; reload before saving");
      if (Object.keys(input.changes).some((key) => !["source_concept_id", "target_concept_id", "relation_type", "note"].includes(key))) bad("Invalid Relation changes");
      if (input.changes.note !== undefined && (!input.changes.note || typeof input.changes.note !== "object" || Array.isArray(input.changes.note))) bad("Relation note must have cn/en text");
      const changed = (field) => own(input.changes, field) ? input.changes[field] : previous[field];
      const next = normalizedRelation({
        source_concept_id: changed("source_concept_id"),
        target_concept_id: changed("target_concept_id"),
        relation_type: changed("relation_type"),
        note: { ...previous.note, ...input.changes.note },
      });
      if (next.source_concept_id !== previous.source_concept_id || next.target_concept_id !== previous.target_concept_id) {
        for (const conceptId of [next.source_concept_id, next.target_concept_id]) if (get(conceptId).lifecycle_status !== "active") throw new RegistryError(409, "archived_concept", "Changed Relation endpoints must be active");
      }
      if (next.source_concept_id === previous.source_concept_id && next.target_concept_id === previous.target_concept_id && next.relation_type === previous.relation_type && JSON.stringify(next.note) === JSON.stringify(previous.note)) return previous;
      const now = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        const updated = db.prepare("UPDATE concept_relations SET source_concept_id = ?, target_concept_id = ?, relation_type = ?, note_cn = ?, note_en = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?").run(next.source_concept_id, next.target_concept_id, next.relation_type, next.note.cn, next.note.en, now, id, previous.version);
        if (!updated.changes) throw new RegistryError(409, "version_conflict", "Relation changed; reload before saving");
        db.prepare("DELETE FROM concept_references WHERE source_type = 'relation' AND source_id = ?").run(String(id));
        for (const conceptId of [next.source_concept_id, next.target_concept_id]) db.prepare("INSERT INTO concept_references (concept_id, source_type, source_id) VALUES (?, 'relation', ?)").run(conceptId, String(id));
        db.exec("COMMIT");
        return getRelation(id);
      } catch (error) { db.exec("ROLLBACK"); if (String(error).includes("UNIQUE constraint")) throw new RegistryError(409, "duplicate_relation", "Relation already exists"); throw error; }
    },
    deleteRelation: (id, input) => {
      const previous = getRelation(id);
      if (!input || !Number.isInteger(input.expected_version) || input.expected_version !== previous.version || Object.keys(input).some((key) => key !== "expected_version")) throw new RegistryError(409, "version_conflict", "Relation changed; reload before deleting");
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM concept_references WHERE source_type = 'relation' AND source_id = ?").run(String(id));
        const removed = db.prepare("DELETE FROM concept_relations WHERE id = ? AND version = ?").run(id, previous.version);
        if (!removed.changes) throw new RegistryError(409, "version_conflict", "Relation changed; reload before deleting");
        db.exec("COMMIT");
        return { deleted: true, id };
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    asset: (hash) => {
      if (!/^[a-f0-9]{64}$/.test(hash)) throw new RegistryError(404, "not_found", "Image not found");
      const row = db.prepare("SELECT data, mime_type FROM media_assets WHERE hash = ?").get(hash);
      if (!row) throw new RegistryError(404, "not_found", "Image not found");
      return { data: Buffer.from(row.data), mime_type: row.mime_type };
    },
    list: () => db.prepare("SELECT data FROM concepts ORDER BY updated_at DESC, id").all().map((row) => publicConcept(JSON.parse(row.data))),
    dashboard: () => {
      const concepts = db.prepare("SELECT data FROM concepts").all().map((row) => publicConcept(JSON.parse(row.data)));
      const active = concepts.filter((concept) => concept.lifecycle_status === "active");
      const locales = Object.fromEntries(["cn", "en"].map((locale) => [locale, {
        browsable: active.filter((concept) => concept.readiness[locale].browsable).length,
        recommendable: active.filter((concept) => concept.readiness[locale].recommendable).length,
      }]));
      const recent_revisions = db.prepare("SELECT revision_id, concept_id, version_after, operation, changed_at, changes FROM revisions ORDER BY revision_id DESC LIMIT 10").all().map((row) => {
        const paths = JSON.parse(row.changes).map((change) => change.path);
        const affected_languages = ["cn", "en"].filter((locale) => paths.some((path) => path.startsWith(`locales.${locale}.`)) || ["archive", "restore"].includes(row.operation));
        return { revision_id: row.revision_id, concept_id: row.concept_id, version: row.version_after, operation: row.operation, changed_at: row.changed_at, affected_languages, shared_changes: paths.some((path) => !path.startsWith("locales.")), changed_paths: paths };
      });
      return {
        active_total: active.length,
        both_draft: active.filter((concept) => !concept.readiness.cn.browsable && !concept.readiness.en.browsable).length,
        locales,
        archived_total: concepts.length - active.length,
        recent_revisions,
      };
    },
    query: ({ locale = "cn", view = "manage", q = "", status = "all", tag = "", domain = "" } = {}) => {
      if (!["cn", "en"].includes(locale)) bad("locale must be cn or en");
      if (!["manage", "browse"].includes(view)) bad("view must be manage or browse");
      if (!["all", "draft", "browsable", "recommendable", "archived"].includes(status)) bad("status is invalid");
      if (domain && !domainCodes.has(domain)) bad("domain is invalid");
      const needle = text(q, "q").toLocaleLowerCase();
      const exactTag = text(tag, "tag");
      return db.prepare("SELECT data FROM concepts ORDER BY updated_at DESC, id").all().map((row) => publicConcept(JSON.parse(row.data))).filter((concept) => {
        const local = concept.locales[locale];
        const ready = concept.readiness[locale];
        if (status === "archived" && concept.lifecycle_status !== "archived") return false;
        if (!["all", "archived"].includes(status) && concept.lifecycle_status !== "active") return false;
        if (view === "browse" && !ready.browsable) return false;
        if (status === "draft" && ready.browsable) return false;
        if (status === "browsable" && !ready.browsable) return false;
        if (status === "recommendable" && !ready.recommendable) return false;
        if (exactTag && !local.tags.includes(exactTag)) return false;
        if (domain && !concept.domains.includes(domain)) return false;
        if (needle && ![local.name, ...local.aliases, local.description, ...local.tags].some((value) => value.toLocaleLowerCase().includes(needle))) return false;
        return true;
      });
    },
    revisions: (id) => { get(id); return db.prepare("SELECT revision_id, concept_id, version_before, version_after, actor, operation, changed_at, changes FROM revisions WHERE concept_id = ? ORDER BY revision_id DESC").all(id).map((row) => ({ ...row, changes: JSON.parse(row.changes) })); },
    create: (input, actor = "local-user") => {
      const concept = fromInput(input);
      if (readRow.get(concept.id)) throw new RegistryError(409, "duplicate_id", `Concept ${concept.id} already exists`);
      const now = new Date().toISOString();
      Object.assign(concept, { version: 1, created_at: now, updated_at: now });
      const changes = changesBetween({}, concept).filter((change) => !["created_at", "updated_at"].includes(change.path) && (change.path === "id" || change.path === "lifecycle_status" || change.path === "version" || (change.after !== "" && change.after !== null && (!Array.isArray(change.after) || change.after.length > 0))));
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("INSERT INTO concepts (id, data, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(concept.id, JSON.stringify(concept), 1, now, now);
        db.prepare("INSERT INTO revisions (concept_id, version_before, version_after, actor, operation, changed_at, changes) VALUES (?, 0, 1, ?, 'create', ?, ?)").run(concept.id, actor, now, JSON.stringify(changes));
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        if (String(error).includes("UNIQUE constraint")) throw new RegistryError(409, "duplicate_id", `Concept ${concept.id} already exists`);
        throw error;
      }
      return publicConcept(concept);
    },
    previewCreate: (input) => publicConcept(fromInput(input, { requireName: false })).readiness,
    previewUpdate: (id, input) => {
      const { previous, next, changes } = prepareUpdate(id, input);
      return { version: previous.version, before: previous.readiness, after: publicConcept(next).readiness, changes };
    },
    update: (id, input, actor = "local-user") => {
      const { previous, next, actions, changes } = prepareUpdate(id, input);
      if (changes.length === 0) return publicConcept(next);
      next.version += 1;
      next.updated_at = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const action of actions) if (action.bytes) db.prepare("INSERT OR IGNORE INTO media_assets (hash, mime_type, byte_size, data, created_at) VALUES (?, 'image/webp', ?, ?, ?)").run(action.hash, action.bytes.length, action.bytes, next.updated_at);
        const result = db.prepare("UPDATE concepts SET data = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?").run(JSON.stringify(next), next.version, next.updated_at, id, previous.version);
        if (!result.changes) throw new RegistryError(409, "version_conflict", "Concept changed; reload before saving");
        db.prepare("INSERT INTO revisions (concept_id, version_before, version_after, actor, operation, changed_at, changes) VALUES (?, ?, ?, ?, 'update', ?, ?)").run(id, previous.version, next.version, actor, next.updated_at, JSON.stringify(changes));
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      return publicConcept(next);
    },
    archive: (id, input, actor) => setLifecycle(id, input, "archived", actor),
    restore: (id, input, actor) => setLifecycle(id, input, "active", actor),
    delete: (id, input) => {
      if (!input || !Number.isInteger(input.expected_version) || input.confirm_id !== id || Object.keys(input).some((key) => !["expected_version", "confirm_id"].includes(key))) bad("expected_version and matching confirm_id are required");
      const concept = get(id);
      if (concept.version !== input.expected_version) throw new RegistryError(409, "version_conflict", "Concept changed; reload before deleting");
      if (concept.lifecycle_status !== "archived") throw new RegistryError(409, "not_archived", "Archive the Concept before permanent deletion");
      db.exec("BEGIN IMMEDIATE");
      try {
        if (db.prepare("SELECT 1 FROM concept_references WHERE concept_id = ? LIMIT 1").get(id)) throw new RegistryError(409, "has_references", "Concept has external references");
        const revisions = db.prepare("SELECT changes FROM revisions WHERE concept_id = ?").all(id);
        const candidates = imageHashes(concept, revisions);
        const deleted = db.prepare("DELETE FROM concepts WHERE id = ? AND version = ? AND json_extract(data, '$.lifecycle_status') = 'archived'").run(id, concept.version);
        if (!deleted.changes) throw new RegistryError(409, "version_conflict", "Concept changed; reload before deleting");
        const stillUsed = new Set();
        for (const row of db.prepare("SELECT data FROM concepts").all()) {
          const remaining = JSON.parse(row.data);
          stillUsed.add(remaining.locales.cn.cover_image); stillUsed.add(remaining.locales.en.cover_image);
        }
        for (const row of db.prepare("SELECT changes FROM revisions").all()) for (const change of JSON.parse(row.changes)) {
          if (change.path.endsWith(".cover_image")) { stillUsed.add(change.before); stillUsed.add(change.after); }
        }
        for (const hash of candidates) if (!stillUsed.has(hash)) db.prepare("DELETE FROM media_assets WHERE hash = ?").run(hash);
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      return { deleted: true, id };
    },
  };
}
