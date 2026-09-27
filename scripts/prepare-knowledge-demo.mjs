import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openRegistry } from "../server/registry.mjs";

export const defaultSamples = fileURLToPath(new URL("../data/examples/knowledge-base-v1.json", import.meta.url));
const present = (path) => { try { lstatSync(path); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } };
const fail = (message) => { throw new Error(message); };

export function prepareKnowledgeDemo({ dbPath, inputPath = defaultSamples } = {}) {
  if (typeof dbPath !== "string" || !dbPath.trim()) fail("Explicit --db path for a NEW database is required");
  const database = resolve(dbPath);
  const files = [database, `${database}-wal`, `${database}-shm`, `${database}-journal`];
  if (files.some(present)) fail("Database or companion file already exists; refusing to overwrite");
  const data = JSON.parse(readFileSync(inputPath, "utf8"));
  if (data?.schema_version !== 1 || !Array.isArray(data.concepts) || !Array.isArray(data.relations)) fail("Expected schema_version 1, concepts and relations arrays");
  const ids = new Set();
  for (const concept of data.concepts) {
    if (!concept || typeof concept.id !== "string" || ids.has(concept.id)) fail("Missing or duplicate Concept ID");
    ids.add(concept.id);
    if (!["cn", "en"].some((locale) => typeof concept.locales?.[locale]?.name === "string" && concept.locales[locale].name.trim())) fail("At least one locale needs a name");
  }
  for (const relation of data.relations) {
    if (!relation || !ids.has(relation.source_concept_id) || !ids.has(relation.target_concept_id)) fail("Relation references a missing Concept");
  }
  let registry;
  let reserved = false;
  try {
    mkdirSync(dirname(database), { recursive: true });
    // Exclusive reservation also rejects symlinks and racing reruns.
    closeSync(openSync(database, "wx"));
    reserved = true;
    registry = openRegistry(database);
    // Validate every Concept before writing the first record. Relation failures
    // below also roll back the entire new demo by removing its database files.
    for (const concept of data.concepts) registry.previewCreate(concept);
    for (const concept of data.concepts) registry.create(concept, "knowledge-demo-v1");
    for (const relation of data.relations) registry.createRelation(relation);
    registry.close();
    registry = null;
    return { db_path: database, concepts: data.concepts.length, relations: data.relations.length, schema_version: data.schema_version };
  } catch (error) {
    try { registry?.close(); } finally {
      registry = null;
      if (reserved) for (const path of files) rmSync(path, { force: true });
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = process.argv[i];
      const value = process.argv[i + 1];
      if (!["--db", "--input"].includes(key) || !value || value.startsWith("--") || args[key]) fail("Usage: npm run demo:prepare -- --db NEW_PATH [--input SAMPLE_JSON]");
      args[key] = value;
    }
    console.log(JSON.stringify(prepareKnowledgeDemo({ dbPath: args["--db"], inputPath: args["--input"] }), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
