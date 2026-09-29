import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openRegistry } from "../server/registry.mjs";

const parseArgs = (argv) => {
  const options = { apply: false, createMissing: false };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--apply") options.apply = true;
    else if (flag === "--create-missing") options.createMissing = true;
    else if (["--db", "--source", "--ids"].includes(flag)) options[flag.slice(2)] = argv[++index];
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!options.db || !options.source || !options.ids) throw new Error("Usage: node scripts/import-local-articles.mjs --db <sqlite> --source <models-data> --ids <comma-separated-slugs> [--apply] [--create-missing]");
  const ids = [...new Set(options.ids.split(",").map((value) => value.trim()))];
  if (!ids.length || ids.some((id) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))) throw new Error("IDs must be comma-separated slugs");
  return { ...options, ids, db: resolve(options.db), source: resolve(options.source) };
};

const frontmatter = (raw) => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
  if (!match) throw new Error("Article frontmatter is missing");
  const meta = Object.fromEntries(match[1].split(/\r?\n/).map((line) => {
    const separator = line.indexOf(":");
    if (separator < 1) throw new Error("Malformed article frontmatter");
    const value = line.slice(separator + 1).trim();
    return [line.slice(0, separator), value.startsWith('"') ? JSON.parse(value) : value];
  }));
  if (meta.language !== "en" || typeof meta.title !== "string" || typeof meta.summary !== "string" || !/^https:\/\//.test(meta.url)) throw new Error("Article metadata needs an English title, summary and HTTPS URL");
  return { meta, body: raw.slice(match[0].length).trim() };
};

function prepareArticle(source, id) {
  const directory = join(source, id);
  const { meta, body } = frontmatter(readFileSync(join(directory, "index.md"), "utf8"));
  const assets = new Map();
  const rewritten = body.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (whole, alt, path) => {
    if (!/^assets\/[A-Za-z0-9._-]+\.png$/.test(path)) throw new Error(`${id}: unsupported image path ${path}`);
    const bytes = readFileSync(join(directory, path));
    if (bytes.length < 24 || bytes.length > 10 * 1024 * 1024 || bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a") throw new Error(`${id}: invalid PNG ${path}`);
    const hash = createHash("sha256").update(bytes).digest("hex");
    assets.set(hash, { data: bytes.toString("base64") });
    return `![${alt}](/api/assets/${hash})`;
  });
  const lines = rewritten.split("\n");
  const firstHeading = lines.findIndex((line) => /^#{1,6}\s/.test(line));
  if (firstHeading >= 0 && lines.slice(0, firstHeading).every((line) => !line.trim() || /^!\[/.test(line.trim())) && lines[firstHeading].replace(/^#{1,6}\s*/, "").trim().toLowerCase() === meta.title.trim().toLowerCase()) lines.splice(firstHeading, 1);
  return { id, title: meta.title, summary: meta.summary, url: meta.url, body: lines.join("\n").trim(), assets: [...assets.values()] };
}

export function importLocalArticles({ db, source, ids, apply = false, createMissing = false }) {
  if (!existsSync(db)) throw new Error(`Database does not exist: ${db}`);
  const articles = ids.map((id) => prepareArticle(source, id));
  const readonly = new DatabaseSync(db, { readOnly: true });
  let actions;
  try {
    const lookup = readonly.prepare("SELECT data FROM concepts WHERE id = ?");
    actions = articles.map((article) => {
      const row = lookup.get(article.id);
      if (!row) {
        if (!createMissing) throw new Error(`${article.id}: no matching Concept ID; use --create-missing only if a new card is intended`);
        return { article, action: "create" };
      }
      const current = JSON.parse(row.data).locales.en.article_body ?? "";
      if (current && current !== article.body) throw new Error(`${article.id}: article already edited; refusing to overwrite it`);
      return { article, action: current === article.body ? "skip" : "update" };
    });
  } finally { readonly.close(); }
  const summary = actions.map(({ article, action }) => ({ id: article.id, action, images: article.assets.length }));
  if (!apply) return { dryRun: true, summary };
  const backup = join(dirname(db), "backups", `articles-before-import-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`);
  mkdirSync(dirname(backup), { recursive: true });
  const snapshot = new DatabaseSync(db, { readOnly: true });
  try { snapshot.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`); } finally { snapshot.close(); }
  const registry = openRegistry(db);
  try {
    for (const { article, action } of actions) {
      if (action === "skip") continue;
      if (action === "create") registry.create({ id: article.id, locales: { en: { name: article.title, description: article.summary, source_text: article.url, article_body: article.body } }, article_assets: article.assets }, "local-article-import");
      else {
        const concept = registry.get(article.id);
        registry.update(article.id, { expected_version: concept.version, changes: { "locales.en.article_body": article.body }, article_assets: article.assets }, "local-article-import");
      }
    }
  } finally { registry.close(); }
  return { dryRun: false, backup, summary };
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  try { console.log(JSON.stringify(importLocalArticles(parseArgs(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
