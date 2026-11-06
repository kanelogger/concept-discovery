import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { sourceFiles, sameInputs, cleanupCoordinator, finishAcceptance, resourceCommands, evidenceArtifact, verifyEgo, egoCheckpoints, writeJSON, updateRun } from "../../scripts/acceptance.mjs";
import { fullRunId, runOwnedChild } from "../../scripts/service-check.mjs";
import { runPath } from "../service/runtime.mjs";
import { checkpointStatus, parseArguments, recordCheckpoint } from "../../scripts/ego-testing.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cd-acceptance-unit-"));
  return { root, dispose: () => rmSync(root, { force: true, recursive: true }) };
}

test("input inventory detects changed, added and removed files while ignoring mtime", () => {
  const f = fixture();
  try {
    mkdirSync(join(f.root, "web"));
    const path = join(f.root, "web/app.jsx");
    writeFileSync(path, "original");
    const first = sourceFiles(f.root);
    writeFileSync(path, "original");
    assert.ok(sameInputs(first, sourceFiles(f.root)));
    writeFileSync(path, "changed");
    assert.ok(!sameInputs(first, sourceFiles(f.root)));
    writeFileSync(path, "original");
    writeFileSync(join(f.root, "web/new.js"), "new input");
    assert.ok(!sameInputs(first, sourceFiles(f.root)));
    rmSync(path);
    assert.ok(!sameInputs(first, sourceFiles(f.root)));
  } finally { f.dispose(); }
});

test("full acceptance requires a specified ego run and refuses reduced modes", () => {
  const id = "cd-service-1234567890";
  assert.equal(fullRunId(["--ego-run", id], {}), id);
  assert.throws(() => fullRunId([], {}), /explicit/);
  assert.throws(() => fullRunId(["--ego-run", "../../user-data"], {}), /explicit/);
  assert.throws(() => fullRunId(["--ego-run", id], { CONCEPT_E2E_COMPONENT_ONLY: "1" }), /rejects/);
  assert.throws(() => fullRunId(["--ego-run", id], { CONCEPT_KEEP_ACCEPTANCE: "1" }), /rejects/);
  assert.throws(() => parseArguments(["verify"]), /explicit/);
  assert.throws(() => parseArguments(["record", "--run", id, "--checkpoint", "unknown"]), /Unknown/);
});

test("generated reports cannot invalidate test inputs while published assets remain inputs", () => {
  const f = fixture();
  try {
    mkdirSync(join(f.root, 'tests/browser/.local'), { recursive: true });
    mkdirSync(join(f.root, 'web/generated'), { recursive: true });
    writeFileSync(join(f.root, 'tests/browser/critical.spec.mjs'), 'test source');
    writeFileSync(join(f.root, 'web/generated/app.js'), 'product asset');
    writeFileSync(join(f.root, 'tests/browser/.local/report.json'), 'first result');
    const before = sourceFiles(f.root);
    writeFileSync(join(f.root, 'tests/browser/.local/report.json'), 'next result');
    assert.ok(sameInputs(before, sourceFiles(f.root)));
    writeFileSync(join(f.root, 'web/generated/app.js'), 'changed product asset');
    assert.ok(!sameInputs(before, sourceFiles(f.root)));
  } finally { f.dispose(); }
});

test("cleanup shares in-flight work and marks success only after exact resource inspection", async () => {
  const run = { privateDirectory: "/synthetic-test" };
  let release;
  const gate = new Promise(yes => { release = yes; });
  const calls = [];
  const cleanup = cleanupCoordinator(run, {
    stopChildren: async () => { calls.push("children"); await gate; },
    stopStack: async () => calls.push("stack"),
    list: async kind => { calls.push(kind); return []; },
    removeImage: async () => calls.push("image"),
    removeDirectory: async () => calls.push("directory"),
    persist: () => calls.push("persist"),
  });
  const first = cleanup();
  const second = cleanup();
  assert.equal(first, second);
  assert.equal(run.cleaned, false);
  release();
  await first;
  assert.equal(run.cleaned, true);
  assert.deepEqual(calls, ["persist", "children", "stack", "containers", "volumes", "networks", "image", "directory", "persist"]);
  await cleanup();
  assert.equal(calls.length, 9, "a completed cleanup is idempotent after its recovery directory was removed");
});

test("residual resources and failed queries preserve recovery directory and can be retried", async () => {
  const run = { privateDirectory: "/synthetic-test" };
  let failure = "leftover";
  let removed = false;
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
  assert.throws(() => resourceCommands("user-production"), /unowned/);
  for (const args of Object.values(resourceCommands("cd-service-1234567890"))) assert.ok(args.includes("label=com.docker.compose.project=cd-service-1234567890"));
});

function pngChunk(type, data) {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, data.length + 8)) >>> 0, data.length + 8);
  return chunk;
}

function pngFixture(width = 1, height = 2, { raw, filter = 0 } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = raw ?? Buffer.alloc((width * 4 + 1) * height, 0);
  if (!raw) for (let y = 0; y < height; y++) rows[y * (width * 4 + 1)] = filter;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(rows)), pngChunk("IEND", Buffer.alloc(0))]);
}

function observedRun(root) {
  const directory = join(root, "reports");
  mkdirSync(directory);
  const files = sourceFiles(root);
  const environment = { node: "synthetic test environment" };
  const run = { schema: 2, runId: "cd-service-1234567890", startedAt: "2026-11-05T10:00:00Z", project: "cd-service-1234567890", label: "ego", repositoryRoot: root, privateDirectory: join(root, "cd-service-removed"), configurationRoot: join(root, "cd-service-removed/private"), url: "http://127.0.0.1:12435", port: 12435, result: "passed", cleaned: true, cleanup: { status: "passed", completedAt: "2026-11-05T10:03:00Z", resources: { containers: [], volumes: [], networks: [] } }, source: { files, endFiles: files, environment }, checkpoints: {} };
  writeFileSync(join(directory, "1280.png"), pngFixture(1280));
  writeFileSync(join(directory, "1440.png"), pngFixture(1440));
  writeJSON(join(directory, "snapshot.json"), { url: run.url, snapshot: "observed visible page" });
  writeJSON(join(directory, "readback.json"), { runId: run.runId, url: run.url, command: "get-document", result: { id: "synthetic-card", markdown: "persisted value" } });
  const artifacts = [evidenceArtifact("1280.png", "screenshot", directory), evidenceArtifact("1440.png", "screenshot", directory), evidenceArtifact("snapshot.json", "snapshot", directory), evidenceArtifact("readback.json", "readback", directory)];
  for (const checkpoint of egoCheckpoints) run.checkpoints[checkpoint] = { status: "passed", expected: "Expected behavior", observation: "Observed real control result", actual: { title: "observed", browserVersion: "Chromium/unit-test-fixture" }, spaceId: 15, recordedAt: "2026-11-05T10:01:00Z", url: run.url, artifacts };
  writeJSON(join(directory, "browser-finished.json"), { spaceId: 15, finishedAt: "2026-11-05T10:02:00Z", result: "resolved" });
  run.browserFinished = evidenceArtifact("browser-finished.json", "browser-finished", directory);
  return { run, directory, options: { root, files, environment } };
}

test("ego evidence needs matching inputs, all observed checkpoints, readable bound artifacts and cleanup", () => {
  const f = fixture();
  try {
    const { run, directory, options } = observedRun(f.root);
    assert.equal(verifyEgo(run, directory, options).valid, true);
    assert.equal(verifyEgo(run, directory, { ...options, files: { changed: "source" } }).valid, false);
    assert.equal(verifyEgo(run, directory, { ...options, environment: { changed: true } }).valid, false);
    run.cleaned = false;
    assert.equal(verifyEgo(run, directory, options).valid, false);
    run.cleaned = true;
    delete run.checkpoints.authoring;
    assert.equal(verifyEgo(run, directory, options).valid, false);
  } finally { f.dispose(); }
});

test("ego evidence rejects modified readback bytes and another instance's observations", () => {
  const f = fixture();
  try {
    const { run, directory, options } = observedRun(f.root);
    writeJSON(join(directory, "readback.json"), { runId: run.runId, url: "http://127.0.0.1:12436", command: "get-document", result: { markdown: "different" } });
    assert.equal(verifyEgo(run, directory, options).valid, false);
    for (const checkpoint of Object.values(run.checkpoints)) checkpoint.artifacts = checkpoint.artifacts.map(artifact => artifact.kind === "readback" ? evidenceArtifact("readback.json", "readback", directory) : artifact);
    assert.ok(verifyEgo(run, directory, options).errors.some(message => message.includes("another acceptance instance")));
  } finally { f.dispose(); }
});


test("input capture and evidence persistence failures still await cleanup", async () => {
  const calls = [];
  const run = { source: { files: { app: "before" } } };
  await assert.rejects(finishAcceptance(run, true, {
    inputs: () => { throw new Error("source unreadable"); },
    cleanup: async () => { calls.push("cleanup"); },
    persist: () => { calls.push("persist"); throw new Error("evidence unwritable"); },
  }), /source unreadable; evidence unwritable/);
  assert.deepEqual(calls, ["cleanup", "persist"]);
  assert.equal(run.result, "failed");
  await assert.rejects(finishAcceptance(run, true, { inputs: () => ({ app: "after" }), cleanup: async () => { calls.push("changed-cleanup"); }, persist: () => {} }), /inputs changed/);
  assert.ok(calls.includes("changed-cleanup"));
});

test("interruption waits for a real child to finish its asynchronous cleanup", async () => {
  const f = fixture();
  try {
    const ready = join(f.root, "ready");
    const cleaned = join(f.root, "cleaned");
    const code = `const fs=require("node:fs");process.on("SIGTERM",()=>{setTimeout(()=>{fs.writeFileSync(${JSON.stringify(cleaned)},"done");process.exit(0)},30)});fs.writeFileSync(${JSON.stringify(ready)},"ready");setInterval(()=>{},100);`;
    const controller = new AbortController();
    const running = runOwnedChild(process.execPath, ["-e", code], { signal: controller.signal, stdio: "ignore" });
    for (let i = 0; !existsSync(ready) && i < 100; i++) await new Promise(yes => setTimeout(yes, 10));
    assert.ok(existsSync(ready), "child installed its cleanup handler");
    controller.abort();
    await assert.rejects(running, /interrupted/);
    assert.equal(readFileSync(cleaned, "utf8"), "done");
  } finally { f.dispose(); }
});


test("runtime cleans partial initialization when a real startup process receives SIGTERM", async () => {
  const f = fixture();
  let partial;
  try {
    const ready = join(f.root, "startup.json");
    const moduleURL = new URL("../service/runtime.mjs", import.meta.url).href;
    const code = `import {runtime} from ${JSON.stringify(moduleURL)};import {writeFileSync} from "node:fs";await runtime("startup-interruption",{build:false,allocatePort:async()=>16888,initialize:async(root,state)=>{writeFileSync(${JSON.stringify(ready)},JSON.stringify({...state,root}));await new Promise(()=>setInterval(()=>{},1000));}});`;
    const controller = new AbortController();
    const running = runOwnedChild(process.execPath, ["--input-type=module", "-e", code], { signal: controller.signal, stdio: "ignore" });
    for (let i = 0; !existsSync(ready) && i < 100; i++) await new Promise(yes => setTimeout(yes, 10));
    assert.ok(existsSync(ready), "real runtime reached its initialization phase");
    partial = JSON.parse(readFileSync(ready, "utf8"));
    assert.ok(existsSync(partial.dir), "startup has allocated its owned temporary directory");
    controller.abort();
    await assert.rejects(running, /interrupted/);
    assert.equal(existsSync(partial.dir), false, "SIGTERM reclaimed the partially initialized directory");
    const report = JSON.parse(readFileSync(partial.evidencePath, "utf8"));
    assert.equal(report.result, "interrupted");
    assert.equal(report.cleaned, true);
    assert.equal(report.cleanup.initializationOnly, true);
  } finally {
    if (partial) rmSync(new URL(".", "file://" + partial.evidencePath), { recursive: true, force: true });
    f.dispose();
  }
});

test("ego completion gate rejects missing, foreign and modified TaskSpace finish receipts", () => {
  const f = fixture();
  try {
    const {run,directory,options} = observedRun(f.root);
    const receipt = run.browserFinished;
    delete run.browserFinished;
    assert.equal(verifyEgo(run,directory,options).valid,false);
    run.browserFinished = receipt;
    writeJSON(join(directory,"browser-finished.json"),{spaceId:99,finishedAt:"2026-11-05T10:02:00Z",result:"resolved"});
    run.browserFinished = evidenceArtifact("browser-finished.json","browser-finished",directory);
    assert.equal(verifyEgo(run,directory,options).valid,false);
    writeJSON(join(directory,"browser-finished.json"),{spaceId:15,finishedAt:"2026-11-05T10:00:00Z",result:"resolved"});
    run.browserFinished = evidenceArtifact("browser-finished.json","browser-finished",directory);
    assert.equal(verifyEgo(run,directory,options).valid,false);
  } finally { f.dispose(); }
});


test("PNG evidence requires complete decodable image chunks, CRCs and scanlines", () => {
  const f = fixture();
  try {
    const path = join(f.root, "capture.png");
    writeFileSync(path, pngFixture());
    const valid = evidenceArtifact("capture.png", "screenshot", f.root);
    assert.equal(valid.width, 1);
    assert.equal(valid.height, 2);
    const signatureOnly = Buffer.alloc(24);
    Buffer.from([137,80,78,71,13,10,26,10]).copy(signatureOnly);
    signatureOnly.writeUInt32BE(1280, 16);
    signatureOnly.writeUInt32BE(1000, 20);
    writeFileSync(path, signatureOnly);
    assert.throws(() => evidenceArtifact("capture.png", "screenshot", f.root), /PNG/);
    writeFileSync(path, pngFixture().subarray(0, -1));
    assert.throws(() => evidenceArtifact("capture.png", "screenshot", f.root), /PNG/);
    const corruptCRC = pngFixture();
    corruptCRC[45] ^= 1;
    writeFileSync(path, corruptCRC);
    assert.throws(() => evidenceArtifact("capture.png", "screenshot", f.root), /CRC/);
    writeFileSync(path, pngFixture(1, 2, { raw: Buffer.alloc(2) }));
    assert.throws(() => evidenceArtifact("capture.png", "screenshot", f.root), /scanline/);
    writeFileSync(path, pngFixture(1, 2, { filter: 5 }));
    assert.throws(() => evidenceArtifact("capture.png", "screenshot", f.root), /filter/);
  } finally { f.dispose(); }
});


test("two real processes preserve checkpoints and newer fields when an attached runtime writer persists", async () => {
  const f = fixture();
  const id = "cd-service-" + randomBytes(5).toString("hex");
  const reportPath = runPath(id);
  const reportDirectory = new URL(".", "file://" + reportPath);
  try {
    const observed = observedRun(f.root);
    cpSync(observed.directory, reportDirectory, { recursive: true });
    const run = { ...observed.run, runId: id, project: id, cleaned: false, result: "incomplete", records: [] };
    delete run.checkpoints.compatibility;
    delete run.browserFinished;
    writeJSON(reportPath, run);
    const ready = join(f.root, "attached");
    const release = join(f.root, "release");
    const runtimeURL = new URL("../service/runtime.mjs", import.meta.url).href;
    const egoURL = new URL("../../scripts/ego-testing.mjs", import.meta.url).href;
    const acceptanceURL = new URL("../../scripts/acceptance.mjs", import.meta.url).href;
    const staleWriterCode = `import {readRun,runPath,createRunWriter} from ${JSON.stringify(runtimeURL)};import{existsSync,writeFileSync}from"node:fs";const evidence=readRun(${JSON.stringify(id)});const persist=createRunWriter(runPath(evidence.runId),evidence);writeFileSync(${JSON.stringify(ready)},"attached");while(!existsSync(${JSON.stringify(release)}))await new Promise(r=>setTimeout(r,5));evidence.records.push({step:"resumed-cli-readback",recordedAt:new Date().toISOString()});persist();`;
    const writer = runOwnedChild(process.execPath, ["--input-type=module", "-e", staleWriterCode], { stdio: "ignore" });
    void writer.catch(() => {});
    for (let i = 0; !existsSync(ready) && i < 100; i++) await new Promise(yes => setTimeout(yes, 10));
    assert.ok(existsSync(ready), "runtime writer captured the old five-checkpoint object");
    const input = { status: "passed", expected: "Legacy card remains readable", observation: "Observed compatibility page", actual: { editable: false }, spaceId: 15, url: run.url, artifacts: [{path:join(observed.directory,"1280.png"),kind:"screenshot"},{path:join(observed.directory,"snapshot.json"),kind:"snapshot"},{path:join(observed.directory,"readback.json"),kind:"readback"}] };
    const recorderCode = `import {recordCheckpoint} from ${JSON.stringify(egoURL)};import{updateRun}from${JSON.stringify(acceptanceURL)};recordCheckpoint(${JSON.stringify(id)},"compatibility",${JSON.stringify(input)});updateRun(${JSON.stringify(reportPath)},r=>({...r,browserFinished:${JSON.stringify(observed.run.browserFinished)}}));`;
    execFileSync(process.execPath, ["--input-type=module", "-e", recorderCode], { stdio: "pipe" });
    writeFileSync(release, "continue");
    await writer;
    const current = JSON.parse(readFileSync(reportPath, "utf8"));
    assert.equal(current.result, "passed");
    assert.deepEqual(current.browserFinished, observed.run.browserFinished);
    assert.equal(current.records.at(-1).step, "resumed-cli-readback");
    assert.equal(checkpointStatus(current, true).observedCount, 6);
    delete current.checkpoints.compatibility;
    assert.throws(() => checkpointStatus(current, true), /assertion failed/);
  } finally { rmSync(reportDirectory, { recursive: true, force: true }); f.dispose(); }
});

test("run transactions release failed writes and closed or failed runs cannot acquire new checkpoints", () => {
  const f = fixture();
  try {
    const path = join(f.root,"run.json");
    writeJSON(path,{runId:"synthetic",result:"failed"});
    assert.throws(()=>updateRun(path,()=>{throw new Error("injected mutation failure")}),/injected/);
    assert.equal(existsSync(path+".lock"),false);
    assert.equal(JSON.parse(readFileSync(path,"utf8")).result,"failed");
    const next = updateRun(path,run=>({...run,checked:true}));
    assert.equal(next.checked,true);
    assert.equal(checkpointStatus({ ...next, checkpoints: Object.fromEntries(egoCheckpoints.map(key=>[key,{status:"passed"}])) }).checkpointsComplete,false);
  } finally { f.dispose(); }
});

test("a real recorder waiting on cleanup's transaction cannot publish a late checkpoint", async () => {
  const f = fixture();
  const id = "cd-service-" + randomBytes(5).toString("hex");
  const reportPath = runPath(id);
  const reportDirectory = new URL(".", "file://" + reportPath);
  try {
    const observed = observedRun(f.root);
    cpSync(observed.directory, reportDirectory, { recursive: true });
    const run = { ...observed.run, runId: id, project: id, cleaned: false, result: "incomplete", records: [] };
    delete run.checkpoints.compatibility;
    writeJSON(reportPath, run);
    const locked = join(f.root, "closing-transaction");
    const release = join(f.root, "release-closing");
    const acceptanceURL = new URL("../../scripts/acceptance.mjs", import.meta.url).href;
    const egoURL = new URL("../../scripts/ego-testing.mjs", import.meta.url).href;
    const closingCode = `import{updateRun}from${JSON.stringify(acceptanceURL)};import{existsSync,writeFileSync}from"node:fs";updateRun(${JSON.stringify(reportPath)},r=>{writeFileSync(${JSON.stringify(locked)},"locked");while(!existsSync(${JSON.stringify(release)}))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);return{...r,closing:true,cleanup:{status:"running"}}});`;
    const closing = runOwnedChild(process.execPath, ["--input-type=module", "-e", closingCode], { stdio: "ignore" });
    void closing.catch(() => {});
    for (let i = 0; !existsSync(locked) && i < 100; i++) await new Promise(yes => setTimeout(yes, 10));
    assert.ok(existsSync(locked));
    const input = { status: "passed", expected: "Compatibility", observation: "Observed before cleanup", actual: { editable: false }, spaceId: 15, url: run.url, artifacts: [{path:join(observed.directory,"1280.png"),kind:"screenshot"}] };
    const recorderCode = `import{recordCheckpoint}from${JSON.stringify(egoURL)};recordCheckpoint(${JSON.stringify(id)},"compatibility",${JSON.stringify(input)});`;
    const recording = runOwnedChild(process.execPath, ["--input-type=module", "-e", recorderCode], { stdio: "ignore" });
    void recording.catch(() => {});
    const copied = new URL("artifacts/compatibility-0-1280.png", reportDirectory);
    for (let i = 0; !existsSync(copied) && i < 100; i++) await new Promise(yes => setTimeout(yes, 10));
    assert.ok(existsSync(copied), "recorder read the live run before cleanup committed");
    writeFileSync(release, "close");
    await closing;
    await assert.rejects(recording, /failed/);
    const current = JSON.parse(readFileSync(reportPath, "utf8"));
    assert.equal(current.closing, true);
    assert.equal(current.result, "incomplete");
    assert.equal(current.checkpoints.compatibility, undefined);
    for (const terminal of ["failed", "interrupted"]) {
      updateRun(reportPath, r => ({...r,closing:false,result:terminal,cleanup:undefined}));
      assert.throws(() => recordCheckpoint(id,"compatibility",input), /open live/);
      assert.equal(JSON.parse(readFileSync(reportPath,"utf8")).result,terminal);
    }
  } finally { rmSync(reportDirectory, { recursive: true, force: true }); f.dispose(); }
});

test("failure publishing the closing state still reclaims resources and keeps evidence incomplete", async () => {
  const run = {privateDirectory:"/synthetic"};
  const calls = [];
  let publications = 0;
  const cleanup = cleanupCoordinator(run, {
    persist:()=>{if (++publications === 1) throw new Error("injected closing publication failure");},
    stopChildren:async()=>calls.push("children"),stopStack:async()=>calls.push("stack"),
    list:async()=>[],removeImage:async()=>calls.push("image"),removeDirectory:async()=>calls.push("directory"),
  });
  await cleanup();
  assert.equal(run.cleaned,true);
  assert.deepEqual(calls,["children","stack","image","directory"]);
  assert.equal(run.cleanup.publicationError,"injected closing publication failure");
});
