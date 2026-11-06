import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

test("new deployment separates credentials and refuses existing data", () => {
  const temp = mkdtempSync(join(tmpdir(), "cd-deploy-test-"));
  const root = join(temp, "private");
  try {
    execFileSync(process.execPath, [resolve("scripts/deploy-init.mjs"), root]);
    const read = (name) => readFileSync(join(root, name), "utf8");
    const client = JSON.parse(read("client.json"));
    const service = JSON.parse(read("service.json"));
    const kernel = JSON.parse(read("kernel.json"));
    assert.equal(client.tokenFile, "agent-token");
    assert.equal(service.kernelConfig, "kernel.json");
    assert.equal(kernel.tokenFile, "kernel-token");
    assert.notEqual(read("agent-token"), read("kernel-token"));
    assert.notEqual(read("access-code"), read("agent-token"));
    assert.match(read("access-code").trim(), /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(client).includes("kernel"));
    const before = read("workspace/conf/conf.json");
    const repeat = spawnSync(process.execPath, [resolve("scripts/deploy-init.mjs"), root]);
    assert.notEqual(repeat.status, 0);
    assert.equal(read("workspace/conf/conf.json"), before);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("development initialization uses the requested default while keeping service tokens random", () => {
  const temp = mkdtempSync(join(tmpdir(), "cd-development-test-"));
  try {
    const root = join(temp, "private");
    execFileSync(process.execPath, [resolve("scripts/deploy-init.mjs"), "--development", root]);
    assert.equal(readFileSync(join(root, "access-code"), "utf8").trim(), "8869527");
    for (const name of ["agent-token", "kernel-token"]) assert.match(readFileSync(join(root, name), "utf8").trim(), /^[a-f0-9]{64}$/);
    const repeated = spawnSync(process.execPath, [resolve("scripts/deploy-init.mjs"), root, "--development"]);
    assert.notEqual(repeated.status, 0);
    assert.equal(readFileSync(join(root, "access-code"), "utf8").trim(), "8869527");
    const invalid = join(temp, "invalid");
    assert.notEqual(spawnSync(process.execPath, [resolve("scripts/deploy-init.mjs"), invalid, "--unknown"]).status, 0);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
