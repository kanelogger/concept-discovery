import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertOwnedRun, cleanupCoordinator, finishRun, resourceCommands, writeJSON } from "../../scripts/test-runtime.mjs";

test("cleanup only accepts the recorded repository and owned temporary directory", t => {
  const repository = mkdtempSync(join(tmpdir(), "cd-test-repository-"));
  const directory = mkdtempSync(join(tmpdir(), "cd-service-"));
  t.after(() => { rmSync(repository, { recursive: true, force: true }); rmSync(directory, { recursive: true, force: true }); });
  const run = { schema: 2, runId: "cd-service-1234567890", project: "cd-service-1234567890", repositoryRoot: repository,
    privateDirectory: directory, configurationRoot: join(directory, "private"), url: "http://127.0.0.1:12345", port: 12345 };
  writeJSON(join(directory, ".acceptance-owner.json"), { runId: run.runId, repositoryRoot: repository });
  assert.doesNotThrow(() => assertOwnedRun(run, repository));
  assert.throws(() => assertOwnedRun({ ...run, project: "production" }, repository), /identity/);
  assert.throws(() => assertOwnedRun({ ...run, configurationRoot: repository }, repository), /resource paths/);
  writeJSON(join(directory, ".acceptance-owner.json"), { runId: "different-run", repositoryRoot: repository });
  assert.throws(() => assertOwnedRun(run, repository), /owner marker/);
  assert.throws(() => resourceCommands("user-production"), /unowned/);
  for (const args of Object.values(resourceCommands(run.project))) assert.ok(args.includes("label=com.docker.compose.project=" + run.project));
});

test("cleanup shares in-flight work and succeeds only after exact resource inspection", async () => {
  const run = { privateDirectory: "/synthetic-test" };
  let release;
  const gate = new Promise(yes => { release = yes; });
  const calls = [];
  const cleanup = cleanupCoordinator(run, {
    stopChildren: async () => { calls.push("children"); await gate; }, stopStack: async () => calls.push("stack"),
    list: async kind => { calls.push(kind); return []; }, removeImage: async () => calls.push("image"),
    removeDirectory: async () => calls.push("directory"), persist: () => calls.push("persist"),
  });
  const first = cleanup();
  assert.equal(first, cleanup());
  assert.equal(run.cleaned, false);
  release();
  await first;
  assert.equal(run.cleaned, true);
  assert.deepEqual(calls, ["persist", "children", "stack", "containers", "volumes", "networks", "image", "directory", "persist"]);
  await cleanup();
  assert.equal(calls.length, 9);
});

test("residual resources and failed inspection retain recovery data and can be retried", async () => {
  const run = { privateDirectory: "/synthetic-test" };
  let failure = "leftover", removed = false;
  const cleanup = cleanupCoordinator(run, {
    stopChildren: async () => {}, stopStack: async () => {},
    list: async kind => {
      if (failure === "query") throw new Error("Docker unavailable");
      return kind === "networks" && failure === "leftover" ? ["owned-network"] : [];
    },
    removeImage: async () => {}, removeDirectory: async () => { removed = true; }, persist: () => {},
  });
  await assert.rejects(cleanup(), /resources remain/);
  assert.equal(removed, false);
  assert.equal(run.cleaned, false);
  assert.equal(run.cleanup.recoveryDirectory, "/synthetic-test");
  failure = "query";
  await assert.rejects(cleanup(), /Docker unavailable/);
  assert.equal(removed, false);
  failure = false;
  await cleanup();
  assert.equal(removed, true);
  assert.equal(run.cleaned, true);
});

test("finishing always cleans resources and does not turn cleanup failure into a passing result", async () => {
  const run = {};
  const calls = [];
  await assert.rejects(finishRun(run, true, {
    cleanup: async () => { calls.push("cleanup"); throw new Error("retained resources"); },
    persist: () => calls.push("persist"),
  }), /retained resources/);
  assert.equal(run.result, "failed");
  assert.deepEqual(calls, ["cleanup", "persist"]);
});

test("private JSON replacement leaves the original readable after a failed serialization", t => {
  const directory = mkdtempSync(join(tmpdir(), "cd-json-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "run.json");
  writeJSON(path, { result: "pending" });
  const circular = {}; circular.self = circular;
  assert.throws(() => writeJSON(path, circular), /circular/i);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { result: "pending" });
  assert.deepEqual(readdirSync(directory), ["run.json"]);
  writeJSON(path, { result: "passed" });
  assert.equal(existsSync(path), true);
});
