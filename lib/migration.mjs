import { markdownTree, criticalMarkdown } from "./markdown.mjs";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { hash, id, save, fail, normalize } from "./siyuan.mjs";
export function exportLibrary(source, destination) {
  destination = resolve(destination);
  if (existsSync(destination))
    fail("exists", "Archive destination must be new");
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  const live = new DatabaseSync(resolve(source), { readOnly: true });
  try {
    live.exec(
      `VACUUM INTO '${join(destination, "source.sqlite").replaceAll("'", "''")}'`,
    );
  } finally {
    live.close();
  }
  const db = new DatabaseSync(join(destination, "source.sqlite"), {
    readOnly: true,
  });
  try {
    if (
      db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" ||
      db.prepare("PRAGMA foreign_key_check").all().length
    )
      fail("source_corrupt", "Source snapshot integrity failure");
    const concepts = db
      .prepare("SELECT data FROM concepts ORDER BY id")
      .all()
      .map((r) => JSON.parse(r.data));
    const relations = db
      .prepare("SELECT * FROM concept_relations ORDER BY id")
      .all();
    const revisions = db
      .prepare("SELECT * FROM revisions ORDER BY revision_id")
      .all();
    const assets = db
      .prepare("SELECT * FROM media_assets ORDER BY hash")
      .all()
      .map((a) => {
        if (hash(a.data) !== a.hash || a.data.length !== a.byte_size)
          fail("asset_corrupt", "Source asset invalid");
        writeFileSync(join(destination, a.hash), a.data, { mode: 0o600 });
        return { hash: a.hash, mime_type: a.mime_type, byte_size: a.byte_size };
      });
    const data = { schema: 1, concepts, relations, revisions, assets };
    save(join(destination, "archive.json"), data);
    save(join(destination, "manifest.json"), {
      archiveHash: hash(data),
      sourceHash: hash(readFileSync(join(destination, "source.sqlite"))),
      counts: {
        concepts: concepts.length,
        relations: relations.length,
        revisions: revisions.length,
        assets: assets.length,
      },
    });
    return {
      destination,
      counts: JSON.parse(readFileSync(join(destination, "manifest.json")))
        .counts,
    };
  } finally {
    db.close();
  }
}
export async function migrate(knowledge, directory, verifyOnly = false) {
  const a = knowledge.api;
  const archive = JSON.parse(readFileSync(join(directory, "archive.json")));
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json")));
  if (hash(archive) !== manifest.archiveHash)
    fail("archive_corrupt", "Archive fingerprint differs");
  if (
    hash(readFileSync(join(directory, "source.sqlite"))) !== manifest.sourceHash
  )
    fail("archive_corrupt", "Source snapshot differs");
  const actualCounts = {
    concepts: archive.concepts.length,
    relations: archive.relations.length,
    revisions: archive.revisions.length,
    assets: archive.assets.length,
  };
  if (
    JSON.stringify(actualCounts) !== JSON.stringify(manifest.counts) ||
    new Set(archive.concepts.map((c) => c.id)).size !== archive.concepts.length
  )
    fail("archive_corrupt", "Archive counts or identities differ");
  const sourceIds = new Set(archive.concepts.map((c) => c.id));
  if (
    archive.relations.some(
      (r) =>
        !sourceIds.has(r.source_concept_id) ||
        !sourceIds.has(r.target_concept_id),
    )
  )
    fail("archive_corrupt", "Relation endpoint missing");
  const receiptPath = join(
    directory,
    "target-" + hash(await a.identity()) + ".json",
  );
  const receipt = existsSync(receiptPath)
    ? JSON.parse(readFileSync(receiptPath))
    : { assets: {}, concepts: {}, relations: {} };
  const persist = () => save(receiptPath, receipt);
  for (const asset of archive.assets) {
    if (!/^[a-f0-9]{64}$/.test(asset.hash))
      fail("archive_corrupt", "Invalid asset filename");
    const bytes = readFileSync(join(directory, asset.hash));
    if (hash(bytes) !== asset.hash)
      fail("asset_corrupt", "Archive asset differs");
    if (!receipt.assets[asset.hash]) {
      if (verifyOnly) fail("migration_incomplete", "Missing asset mapping");
      const form = new FormData();
      form.append("assetsDirPath", "/assets/");
      form.append(
        "file[]",
        new Blob([bytes], { type: asset.mime_type }),
        asset.hash + (asset.mime_type === "image/png" ? ".png" : ".webp"),
      );
      const r = await fetch(a.origin + "/api/asset/upload", {
        method: "POST",
        redirect: "error",
        headers: { Authorization: "Token " + a.c.token },
        body: form,
      });
      const data = await r.json();
      if (!r.ok || data.code !== 0) fail("upload", "Asset upload failed");
      receipt.assets[asset.hash] = Object.values(data.data.succMap)[0];
      persist();
    }
  }
  const rewrite = (s) =>
    typeof s === "string"
      ? s.replace(/\/api\/assets\/([a-f0-9]{64})/g, (_, h) => {
          if (!receipt.assets[h])
            fail("asset_missing", "Unmapped media reference");
          return receipt.assets[h];
        })
      : s;
  const mapped = (c) => {
    const next = structuredClone(c);
    for (const l of ["cn", "en"]) {
      next.locales[l].article_body = rewrite(
        next.locales[l].article_body ?? "",
      );
      next.locales[l].cover_images = (next.locales[l].cover_images ?? []).map(
        (h) => receipt.assets[h] ?? h,
      );
      next.locales[l].cover_image = next.locales[l].cover_images[0] ?? "";
    }
    return next;
  };
  const readback = [];
  const normalizationDifferences = [];
  for (const c of archive.concepts) {
    if (!receipt.concepts[c.id]) {
      if (verifyOnly) fail("migration_incomplete", "Missing concept");
      const result = await knowledge.create({
        op_id: "migration-" + manifest.archiveHash.slice(0, 16) + "-" + hash(c.id).slice(0,32),
        concept: mapped(c),
      });
      receipt.concepts[c.id] = result.id;
      persist();
    }
    const current = await knowledge.get(receipt.concepts[c.id], {
      sections: false,
    });
    const expected = mapped(c);
    readback.push(current);
    for (const [k, v] of Object.entries(expected)) {
      if (k === "readiness") continue;
      if (k === "locales") {
        for (const l of ["cn", "en"])
          for (const [f, value] of Object.entries(v[l])) {
            let comparison = "exact-fields-or-mdast";
            let differs =
              f === "article_body"
                ? JSON.stringify(markdownTree(current.locales[l][f])) !==
                  JSON.stringify(markdownTree(value))
                : JSON.stringify(current.locales[l][f]) !==
                  JSON.stringify(value);
            if (differs && f === "article_body") {
              const clean = (h) =>
                h
                  .split(/(<pre[\s\S]*?<\/pre>)/)
                  .map((part, i) =>
                    i % 2
                      ? part
                      : part
                          .replace(
                            /<\/(strong|em|code)>\s+(?=(?:&quot;|&#39;|[.,;:!?，。？！；：”’]))/g,
                            "</$1>",
                          )
                          .replace(
                            /<li>\s*<p>((?:(?!<\/p>)[\s\S])*)<\/p>\s*<\/li>/g,
                            "<li>$1</li>",
                          )
                          .replace(/\u200b|&#8203;|&#x200b;/gi, "")
                          .replace(
                            /([\u4e00-\u9fff，。！？；：])<\/(strong|em|code)> (?=[\u4e00-\u9fff，。！？；：])/g,
                            "$1</$2>",
                          )
                          .replace(
                            / (?:id="[0-9]{14}-[a-z0-9]{7}"|updated="[0-9]{14}")/g,
                            "",
                          )
                          .replace(
                            /<\/(strong|em|code)>\s+(?=(?:&quot;|&#39;|[.,;:!?，。？！；：”’]))/g,
                            "</$1>",
                          )
                          .replace(
                            /<li>\s*<p>((?:(?!<\/p>)[\s\S])*)<\/p>\s*<\/li>/g,
                            "<li>$1</li>",
                          )
                          .replace(
                            /<li>\s*<p>((?:(?!<\/p>)[\s\S])*)<\/p>\s*(?=<(?:ul|ol)>)/g,
                            "<li>$1\n",
                          ),
                  )
                  .join("");
              const rendered = await Promise.all(
                [current.locales[l][f], value].map((markdown) =>
                  a.api("/api/lute/md2html", { markdown }),
                ),
              );
              comparison = "normalized-native-render";
              differs =
                clean(rendered[0].html).replace(/[ \t]+/g, " ") !==
                  clean(rendered[1].html).replace(/[ \t]+/g, " ") ||
                JSON.stringify(criticalMarkdown(current.locales[l][f])) !==
                  JSON.stringify(criticalMarkdown(value));
              if (differs)
                save(join(directory, "render-mismatch.json"), {
                  actual: clean(rendered[0].html),
                  expected: clean(rendered[1].html),
                });
            }
            if (differs && f === "article_body") {
              const rendered = await Promise.all(
                [current.locales[l][f], value].map((markdown) =>
                  a.api("/api/lute/md2html", { markdown }),
                ),
              );
              const text = (h) =>
                h
                  .replace(/<[^>]+>/g, "\n")
                  .replace(/\u200b|&#8203;|&#x200b;/gi, "")
                  .replace(/^\s*(?:[-*+]|[0-9]+[.)])\s+/gm, "")
                  .replace(/\s+/g, " ")
                  .trim();
              const actualText = text(rendered[0].html),
                sourceText = text(rendered[1].html);
              const criticalEqual =
                JSON.stringify(criticalMarkdown(current.locales[l][f])) ===
                JSON.stringify(criticalMarkdown(value));
              if (actualText === sourceText && criticalEqual) {
                comparison = "normalized-text-and-exact-code-links-images";
                differs = false;
              }
            }
            if (differs) {
              save(join(directory, "mismatch.json"), {
                id: c.id,
                locale: l,
                field: f,
                actual: current.locales[l][f],
                expected: value,
              });
              fail("migration_mismatch", `Field differs: ${c.id}/${l}/${f}`);
            }
            if (f === "article_body" && current.locales[l][f] !== value)
              normalizationDifferences.push({
                id: c.id,
                locale: l,
                sourceMarkdownHash: hash(value),
                targetMarkdownHash: hash(current.locales[l][f]),
                comparison,
                reason:
                  "Native Markdown normalization; exact original retained in archive",
              });
          }
      } else if (JSON.stringify(current[k]) !== JSON.stringify(v))
        fail("migration_mismatch", `Metadata differs: ${k}`);
    }
  }
  for (const relation of archive.relations) {
    {
      if (!receipt.relations[relation.id] && verifyOnly)
        fail("migration_incomplete", "Missing relation");
      const rid = receipt.relations[relation.id] ?? id();
      receipt.relations[relation.id] = rid;
      persist();
      const found = await a.sql(
        `SELECT id FROM blocks WHERE id='${rid}' AND box='${a.c.notebookId}'`,
      );
      if (!found.length && verifyOnly)
        fail("migration_incomplete", "Target relation missing");
      if (!found.length)
        await a.newDoc(
          rid,
          relation.relation_type,
          `[来源](kane://blocks/${receipt.concepts[relation.source_concept_id]}) → [目标](kane://blocks/${receipt.concepts[relation.target_concept_id]})\n\n${relation.note_cn}\n\n${relation.note_en}`,
          a.c.relationsRootId,
        );
      if (!verifyOnly) {
        const existing = await a.attrs(rid);
        if (
          existing["custom-cd-relation"] &&
          existing["custom-cd-relation"] !== JSON.stringify(relation)
        )
          fail("migration_mismatch", "Existing relation changed");
        await a.setAttrs(rid, {
          "custom-cd-kind": "relation",
          "custom-cd-relation": JSON.stringify(relation),
        });
      }
    }
    const actual = JSON.parse(
      (await a.attrs(receipt.relations[relation.id]))["custom-cd-relation"],
    );
    if (JSON.stringify(actual) !== JSON.stringify(relation))
      fail("migration_mismatch", "Relation differs");
  }
  for (const asset of archive.assets) {
    const r = await fetch(a.origin + "/" + receipt.assets[asset.hash], {
      headers: { Authorization: "Token " + a.c.token },
      redirect: "error",
    });
    if (!r.ok || hash(Buffer.from(await r.arrayBuffer())) !== asset.hash)
      fail("asset_corrupt", "Target asset differs");
  }
  if (!verifyOnly) await a.flush();
  if (verifyOnly) save(join(directory, "target-readback.json"), readback);
  const conceptIds = Object.values(receipt.concepts),
    relationIds = Object.values(receipt.relations);
  if (
    new Set(conceptIds).size !== actualCounts.concepts ||
    new Set(relationIds).size !== actualCounts.relations
  )
    fail("migration_mismatch", "Target mapping identity set differs");
  return {
    verified: true,
    normalizationDifferences,
    counts: actualCounts,
    targetUniqueConcepts: new Set(conceptIds).size,
    targetUniqueRelations: new Set(relationIds).size,
    archiveHash: manifest.archiveHash,
    target: await a.identity(),
  };
}
