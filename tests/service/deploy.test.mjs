import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

test("new deployment opens the browser directly, separates service credentials and refuses existing data", () => {
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
    assert.deepEqual(service.auth, { mode: "local" });
    assert.equal(kernel.tokenFile, "kernel-token");
    assert.notEqual(read("agent-token"), read("kernel-token"));
    assert.equal(existsSync(join(root, "access-code")), false);
    assert.equal(Object.hasOwn(service, "accessCodeFile"), false);
    for (const name of ["agent-token", "kernel-token"]) assert.match(read(name).trim(), /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(client).includes("kernel"));
    const before = read("workspace/conf/conf.json");
    const repeat = spawnSync(process.execPath, [resolve("scripts/deploy-init.mjs"), root]);
    assert.notEqual(repeat.status, 0);
    assert.equal(read("workspace/conf/conf.json"), before);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("required authentication is checked before touching the knowledge kernel", () => {
  const root = mkdtempSync(join(tmpdir(), "cd-auth-bootstrap-"));
  try {
    const file = join(root, "service.json");
    writeFileSync(file, JSON.stringify({
      publicUrl: "https://concept-discovery.invalid",
      auth: { mode: "required", databaseFile: "owner.sqlite" },
      kernelConfig: "absent-kernel.json",
    }), { mode: 0o600 });
    const result = spawnSync(process.execPath, [resolve("scripts/service-start.mjs")], {
      env: { ...process.env, CONCEPT_SERVICE_CONFIG: file }, encoding: "utf8", timeout: 3_000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /auth_file_permissions|认证文件缺失/);
    assert.doesNotMatch(result.stderr, /absent-kernel\.json|Knowledge storage readiness timeout/);
    assert.deepEqual(readdirSync(root), ["service.json"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("removed access-code development mode is rejected without creating a private directory", () => {
  const temp = mkdtempSync(join(tmpdir(), "cd-init-options-test-"));
  try {
    const root = join(temp, "private");
    const removed = spawnSync(process.execPath, [resolve("scripts/deploy-init.mjs"), root, "--development"]);
    assert.notEqual(removed.status, 0);
    assert.equal(existsSync(root), false);
    const invalid = join(temp, "invalid");
    assert.notEqual(spawnSync(process.execPath, [resolve("scripts/deploy-init.mjs"), invalid, "--unknown"]).status, 0);
    assert.equal(existsSync(invalid), false);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("initialization publishes only a successful identity and never serializes a resolved token", async () => {
  const {initializeLibrary} = await import("../../lib/siyuan.mjs");
  const dir = mkdtempSync(join(tmpdir(),"cd-init-identity-"));
  try {
    const file = join(dir,"kernel.json");
    const settings = {url:"http://kernel:6806", tokenFile:"kernel-token", dataDir:"operations"};
    const previous = JSON.stringify(settings);
    writeFileSync(file,previous,{mode:0o600});
    const api = {c:{...settings,token:"synthetic-secret"}, initialize:async () => {throw Error("kernel failed");}};
    await assert.rejects(initializeLibrary(api,file), /kernel failed/);
    assert.equal(readFileSync(file,"utf8"),previous);
    const identity = {notebookId:"notebook",libraryRootId:"root",relationsRootId:"relations"};
    api.initialize = async name => {assert.equal(name,"fixture"); return identity;};
    assert.deepEqual(await initializeLibrary(api,file,"fixture"),identity);
    assert.deepEqual(JSON.parse(readFileSync(file,"utf8")), {...settings,...identity});
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
