// Opt-in only: run after storage/backup protocol changes, not every feature check.
import assert from "node:assert/strict";
import { cpSync, readFileSync, writeFileSync, lstatSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runtime, digest } from "./runtime.mjs";
import { sourceSnapshot, syncRawSources } from "./source-fixture.mjs";

function metadataManifest(root) {
  const result = {};
  function visit(relative) {
    const path = join(root, relative), stat = lstatSync(path);
    assert.equal(stat.isSymbolicLink(), false);
    if (stat.isDirectory()) for (const name of readdirSync(path).sort()) visit(join(relative, name));
    else if (stat.isFile()) result[relative] = digest(readFileSync(path));
  }
  for (const name of ["wiki", "operations", "raw-sync"]) visit(name);
  return result;
}

const original = await runtime("backup");
let restored, passed = false;
try {
  const source = sourceSnapshot("backup-source", { title: "备份样本", markdown: "完整原文与引用。", version: 2 });
  await syncRawSources(original, [source]);
  const literal = "echo $$ $&";
  const created = await original.createDocument({ op_id: "backup-card", title: "备份卡", markdown: `## 核心理解\n\n冷备恢复后仍能读到原文。\n\n## 我的理解\n\n人的解释保留。\n\n[原文](/wiki?source=${source.id})\n\n~~~sh\n${literal}\n~~~` });
  const card = await original.call("get-document", { id: created.id });
  const historical = await original.core(`
    const fs=await import('node:fs');const path=await import('node:path');const{hash,canonical}=await import('./lib/siyuan.mjs');
    const base=path.resolve(path.dirname(api.c.dataDir),'wiki',hash(canonical(await api.identity())));
    const record={id:'prop_'+ 'a'.repeat(32),kind:'proposal',state:'unknown',items:[],createdAt:'2026-11-01',updatedAt:'2026-11-01'};
    const proposal={...record,revision:hash(canonical(record))};fs.writeFileSync(path.join(base,'proposals',proposal.id+'.json'),JSON.stringify(proposal));
    console.log(JSON.stringify(proposal));
  `);
  const identity = await original.core("console.log(JSON.stringify(await api.identity()));");
  const repository = resolve(new URL("../../", import.meta.url).pathname);
  await promisify(execFile)("docker", ["compose", "-p", original.name, "--env-file", join(original.root, "compose.env"), "-f", join(repository, "deploy/compose.yaml"), "stop", "app", "kernel"], { timeout: 120000 });
  const backup = join(original.dir, "cold-backup");
  cpSync(original.root, backup, { recursive: true, force: false, errorOnExist: true });
  const before = metadataManifest(original.root);
  assert.deepEqual(metadataManifest(backup), before);
  restored = await runtime("restore", { build: false, initialize(root) {
    cpSync(backup, root, { recursive: true, force: false, errorOnExist: true });
    const file = join(root, "compose.env");
    writeFileSync(file, readFileSync(file, "utf8").replace(/^CONCEPT_PRIVATE_ROOT=.*$/m, "CONCEPT_PRIVATE_ROOT=" + root).replace(/^CONCEPT_PORT=.*$/m, "CONCEPT_PORT=6806").replace(/^COMPOSE_PROJECT_NAME=.*\n?/m, ""), { mode: 0o600 });
    assert.deepEqual(metadataManifest(root), before);
  } });
  assert.equal(await restored.core("console.log(JSON.stringify(await api.identity()));"), identity);
  assert.deepEqual(await restored.call("source-get", { id: source.id }), source);
  assert.deepEqual(await restored.call("wiki-proposal", { id: historical.id }), historical);
  const read = await restored.call("get-document", { id: card.id });
  assert.equal(read.markdown, card.markdown); assert.equal(read.editable, false);
  assert.equal((await restored.admin("operation-status", { op_id: "backup-card" })).state, "verified");
  const exported = join(restored.dir, "export-after-restore");
  assert.equal((await restored.raw(exported, "export", exported)).cards, 1);
  const bindings = JSON.parse(readFileSync(join(exported, ".sync.json"), "utf8"));
  const binding = Object.values(bindings.cards).find(row => row.remoteId === card.id);
  assert.equal(binding.revision, read.revision);
  assert.ok(read.markdown.includes(literal));
  assert.ok(readFileSync(join(exported, binding.path), "utf8").includes(literal));
  restored.record("private-cold-restore", { sourceId: source.id, cardId: card.id, historicalProposal: historical.id, identityPreserved: true, privateMetadataByteExact: true });
  passed = true;
  console.log("PASS opt-in private cold backup and restore");
} finally {
  const failures = [];
  for (const instance of [restored, original]) {
    if (!instance) continue;
    try { await instance.finish(passed); }
    catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, "Cold restore resource cleanup failed");
}
