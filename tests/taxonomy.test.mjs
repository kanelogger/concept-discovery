import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import taxonomy from "../shared/taxonomy.json" with { type: "json" };
import { openRegistry } from "../server/registry.mjs";

test("expanded controlled taxonomy preserves catalog values and rejects unknown codes", () => {
  const directory = mkdtempSync(join(tmpdir(), "concept-taxonomy-"));
  const registry = openRegistry(join(directory, "registry.sqlite"));
  try {
    for (const group of Object.values(taxonomy)) {
      assert.equal(new Set(group.map(({ code }) => code)).size, group.length);
      assert.ok(group.every(({ cn, en }) => cn.trim() && en.trim()));
    }
    const created = registry.create({
      id: "classification-sample", interaction_type: "lens", epistemic_type: "effect",
      domains: ["psychology", "software-engineering"], intents: ["avoid-error", "decide"],
      locales: { cn: { name: "效应样例", description: "用于检验分类", source_text: "测试出处", trigger: ["需要判断"], agent_instruction: "先检查条件" } },
    });
    assert.equal(created.readiness.cn.recommendable, true);
    assert.deepEqual(created.domains, ["psychology", "software-engineering"]);
    assert.deepEqual(created.intents, ["avoid-error", "decide"]);
    assert.deepEqual(registry.query({ locale: "cn", view: "browse", domain: "psychology" }).map(({ id }) => id), ["classification-sample"]);
    const updated = registry.update("classification-sample", { expected_version: 1, changes: { epistemic_type: "fallacy", domains: ["statistics"], intents: ["evaluate"] } });
    assert.equal(updated.epistemic_type, "fallacy");
    assert.deepEqual(updated.domains, ["statistics"]);
    assert.deepEqual(updated.intents, ["evaluate"]);
    assert.throws(() => registry.update("classification-sample", { expected_version: 2, changes: { epistemic_type: "unsupported" } }), /epistemic_type is invalid/);
    assert.throws(() => registry.update("classification-sample", { expected_version: 2, changes: { domains: ["unknown-domain"] } }), /unknown code/);
    assert.throws(() => registry.update("classification-sample", { expected_version: 2, changes: { intents: ["unknown-intent"] } }), /unknown code/);
    assert.deepEqual(registry.get("classification-sample").domains, ["statistics"]);
  } finally {
    registry.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
