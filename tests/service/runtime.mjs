import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { repositoryRoot as projectRoot, sourceFiles, environmentSnapshot, sameInputs, assertOwnedRun, resourceCommands, cleanupCoordinator, finishAcceptance, createRunWriter, digest, writeJSON } from "../../scripts/acceptance.mjs";
export { digest, writeJSON, createRunWriter };
const exec = promisify(execFile);
export const acceptanceDirectory = resolve(projectRoot, ".local/service-acceptance");
export function runPath(runId) {
  if (!/^cd-service-[a-f0-9]{10}$/.test(runId)) throw new Error("Invalid acceptance run ID");
  return join(acceptanceDirectory, runId, "run.json");
}
export function readRun(runId) { return JSON.parse(readFileSync(runPath(runId), "utf8")); }
const redact = (text, secrets) => secrets.filter(Boolean).reduce((value, secret) => value.replaceAll(secret, "[redacted]"), String(text ?? ""));

export async function runtime(label, { resume, build = true, ready = true, initialize, allocatePort } = {}) {
  if (!/^[a-z][a-z-]*$/.test(label)) throw new Error("Invalid acceptance scope");
  if (!resume && build) execFileSync(process.execPath, [resolve(projectRoot, "scripts/build-web.mjs")], { cwd: projectRoot, stdio: "inherit" });
  let evidence, evidencePath, dir, root, name, url, port, env, cleanup, writer;
  let started = false;
  let signalHandler, startupServer, partialCleanupPromise;
  let signalling = false;
  const active = new Set();
  const secrets = [];
  const persist = () => { if (evidencePath) { writer ??= createRunWriter(evidencePath, evidence); writer(); } };
  const runProcess = async (command, args, input) => {
    const promise = exec(command, args, { cwd: projectRoot, env, maxBuffer: 16 * 1024 * 1024, timeout: 300000 });
    const operation = { child: promise.child, promise };
    active.add(operation);
    if (input !== undefined) promise.child.stdin.end(input);
    try { return (await promise).stdout; }
    catch (error) { throw new Error(redact(error.stderr || error.message, secrets)); }
    finally { active.delete(operation); }
  };
  const docker = (args, input) => runProcess("docker", args, input);
  const stopChildren = async () => {
    const operations = [...active];
    for (const operation of operations) operation.child.kill("SIGTERM");
    const timer = setTimeout(() => { for (const operation of operations) operation.child.kill("SIGKILL"); }, 2000);
    try { await Promise.allSettled(operations.map(operation => operation.promise)); }
    finally { clearTimeout(timer); }
  };
  const removeSignals = () => { process.removeListener("SIGINT", signalHandler); process.removeListener("SIGTERM", signalHandler); };
  const recover = () => {
    if (partialCleanupPromise) return partialCleanupPromise;
    partialCleanupPromise = (async () => {
      if (cleanup) { await cleanup(); return; }
      await stopChildren();
      if (startupServer?.listening) await new Promise(yes => startupServer.close(yes));
      if (started) throw new Error("Cannot clean a partially configured running stack");
      if (dir) rmSync(dir, { recursive: true, force: true });
      if (evidence) {
        evidence.cleaned = true;
        evidence.cleanup = { status: "passed", initializationOnly: true, completedAt: new Date().toISOString(), resources: { containers: [], volumes: [], networks: [] } };
        persist();
      }
    })().finally(() => { partialCleanupPromise = null; });
    return partialCleanupPromise;
  };
  const checkInterrupted = () => { if (signalling) throw new Error("Acceptance initialization interrupted"); };
  signalHandler = () => {
    if (signalling) return;
    signalling = true;
    if (evidence) evidence.result = "interrupted";
    recover().catch(error => { process.stderr.write("Acceptance cleanup failed: " + error.message + "\n"); }).finally(() => { removeSignals(); process.exit(130); });
  };
  // Register before creating the first temporary directory or starting initialization.
  process.on("SIGINT", signalHandler);
  process.on("SIGTERM", signalHandler);
  try {
    if (resume) {
      evidence = readRun(resume);
      assertOwnedRun(evidence);
      if (evidence.cleaned) throw new Error("Acceptance run is already cleaned");
      ({ privateDirectory: dir, configurationRoot: root, project: name, url, port } = evidence);
      started = evidence.stackMayExist === true;
      evidencePath = runPath(resume);
      writer = createRunWriter(evidencePath, evidence);
    } else {
      dir = mkdtempSync(join(tmpdir(), "cd-service-"));
      root = join(dir, "private");
      name = "cd-service-" + randomBytes(5).toString("hex");
      writeJSON(join(dir, ".acceptance-owner.json"), { runId: name, repositoryRoot: projectRoot });
      if (allocatePort) port = await allocatePort();
      else {
        startupServer = createServer();
        try {
          await new Promise((yes, no) => { startupServer.once("error", no); startupServer.listen(0, "127.0.0.1", yes); });
          checkInterrupted();
          port = startupServer.address().port;
        } finally { if (startupServer.listening) await new Promise(yes => startupServer.close(yes)); }
      }
      checkInterrupted();
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid acceptance port");
      url = "http://127.0.0.1:" + port;
      const evidenceDir = join(acceptanceDirectory, name);
      mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
      evidencePath = join(evidenceDir, "run.json");
      evidence = { schema: 2, runId: name, label, project: name, repositoryRoot: projectRoot, privateDirectory: dir, configurationRoot: root, url, port, startedAt: new Date().toISOString(), cleaned: false, records: [] };
      persist();
      if (initialize) await initialize(root, { dir, name, evidencePath });
      else await runProcess(process.execPath, [resolve(projectRoot, "scripts/deploy-init.mjs"), root, ...(label === "preview" ? ["--development"] : [])]);
      checkInterrupted();
      const service = JSON.parse(readFileSync(join(root, "service.json"), "utf8"));
      service.publicUrl = url;
      writeJSON(join(root, "service.json"), service);
      writeJSON(join(root, "client.json"), { url, tokenFile: "agent-token" });
      const values = readFileSync(join(root, "compose.env"), "utf8").replace("CONCEPT_PORT=6806", "CONCEPT_PORT=" + port);
      writeFileSync(join(root, "compose.env"), values, { mode: 0o600 });
    }
    env = { ...process.env };
    const values = readFileSync(join(root, "compose.env"), "utf8");
    for (const line of values.trim().split("\n")) {
      const split = line.indexOf("=");
      env[line.slice(0, split)] = line.slice(split + 1);
    }
    const token = readFileSync(join(root, "agent-token"), "utf8").trim();
    const accessCode = readFileSync(join(root, "access-code"), "utf8").trim();
    secrets.push(token, accessCode, readFileSync(join(root, "kernel-token"), "utf8").trim(), env.KERNEL_ACCESS_CODE);
    const compose = ["compose", "-p", name, "--env-file", join(root, "compose.env"), "-f", resolve(projectRoot, "deploy/compose.yaml")];
    cleanup = cleanupCoordinator(evidence, {
      stopChildren,
      stopStack: async () => { assertOwnedRun(evidence); if (started) await docker([...compose, "down", "--remove-orphans", "--volumes", "--timeout", "5"]); },
      list: async kind => (await docker(resourceCommands(name)[kind])).trim().split("\n").filter(Boolean),
      removeImage: async () => {
        const image = name + "-app:latest";
        const matches = (await docker(["image", "ls", "--filter", "reference=" + image, "--format", "{{.Repository}}:{{.Tag}}"])) .trim().split("\n").filter(Boolean);
        if (matches.some(value => value !== image)) throw new Error("Unexpected application image tag");
        if (matches.length) await docker(["image", "rm", image]);
        if ((await docker(["image", "ls", "--filter", "reference=" + image, "--format", "{{.Repository}}:{{.Tag}}"])).trim()) throw new Error("Owned application image tag remains");
      },
      removeDirectory: async () => { assertOwnedRun(evidence); rmSync(dir, { recursive: true, force: true }); if (existsSync(dir)) throw new Error("Acceptance directory remains"); },
      persist,
    });
    const record = (step, data) => { evidence.records.push({ step, recordedAt: new Date().toISOString(), ...data }); persist(); };
    if (!resume) {
      evidence.source = { head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim(), files: sourceFiles(), environment: environmentSnapshot() };
      persist();
      await docker([...compose, "config", "--quiet"]);
      started = true;
      evidence.stackMayExist = true;
      persist();
      await docker([...compose, "up", "--build", "-d"]);
    }
    const waitReady = async () => {
      for (let attempt = 0; attempt < 180; attempt++) {
        try { if ((await fetch(url + "/api/session", { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
        await new Promise(yes => setTimeout(yes, 500));
      }
      throw new Error("Application readiness timeout");
    };
    if (ready) await waitReady();
    const kernel = async (path, body = {}) => {
      const code = "import{readFileSync}from'node:fs';import{config,Siyuan}from'./lib/siyuan.mjs';const p=JSON.parse(readFileSync(0,'utf8'));const a=new Siyuan(config('/state/kernel.json'));console.log(JSON.stringify(await a.api(p.path,p.body)));";
      return JSON.parse(await docker([...compose, "exec", "-T", "app", "node", "--input-type=module", "-e", code], JSON.stringify({ path, body })));
    };
    const core = async (script, input = {}) => JSON.parse(await docker([...compose, "exec", "-T", "app", "node", "--input-type=module", "-e", "import{readFileSync}from'node:fs';import{config,Siyuan}from'./lib/siyuan.mjs';import{execute}from'./lib/commands.mjs';const input=JSON.parse(readFileSync(0,'utf8'));const api=new Siyuan(config('/state/kernel.json'));" + script], JSON.stringify(input)));
    if (!resume) {
    const identity = JSON.parse(readFileSync(join(root, "kernel.json"), "utf8"));
    const bindingText = await docker([...compose, "ps", "--format", "json"]);
    const bindings = bindingText.trim().startsWith("[") ? JSON.parse(bindingText) : bindingText.trim().split("\n").map((line) => JSON.parse(line));
    const appBinding = bindings.find((container) => container.Service === "app");
    const kernelBinding = bindings.find((container) => container.Service === "kernel");
    assert.equal(appBinding.Publishers.filter((entry) => entry.PublishedPort).length, 1);
    assert.ok(appBinding.Publishers.some((entry) => entry.URL === "127.0.0.1" && entry.TargetPort === 3000 && entry.PublishedPort === port));
    assert.ok(kernelBinding.Publishers.every((entry) => !entry.PublishedPort));
    const inspect = JSON.parse(await docker(["inspect", ...bindings.map((container) => container.ID)]));
    record("isolated-runtime", {
      ids: { notebookId: identity.notebookId, libraryRootId: identity.libraryRootId },
      kernelVersion: await kernel("/api/system/version"),
      bindings,
      composeConfigurationValid: true,
      appRuntime: await core("console.log(JSON.stringify({node:process.version}));"),
      containers: inspect.map((container) => ({ name: container.Name, image: container.Config.Image, user: container.Config.User, mounts: container.Mounts.map(({ Source, Destination, RW }) => ({ Source, Destination, RW })) })),
    });
    }
    const call = async (command, input, expectedOK = true) => {
      const response = await fetch(url + "/api/v1/commands/" + command, {
        method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify(input),
      });
      const result = await response.json();
      if (result.ok !== expectedOK) throw new Error(command + ": " + JSON.stringify(result));
      return expectedOK ? result.data : result.error;
    };
    let cliPath;
    const packageCLI = async () => {
      if (cliPath) return cliPath;
      const output = execFileSync("npm", ["pack", "--json", "--pack-destination", dir], { cwd: projectRoot, encoding: "utf8" });
      const parsed = JSON.parse(output); const packed = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
      const prefix = join(dir, "installed");
      execFileSync("npm", ["install", "--prefix", prefix, "--ignore-scripts", "--offline", "--no-audit", "--no-fund", join(dir, packed.filename)], { cwd: dir, stdio: "pipe" });
      cliPath = join(prefix, "node_modules/concept-discovery/bin/concept-discovery.mjs");
      const packedFiles = new Set(packed.files.map((file) => file.path));
      const manifest = JSON.parse(readFileSync(resolve(projectRoot, "web/generated/manifest.json"), "utf8"));
      const assets = {};
      for (const asset of [...manifest.assets, { path: "manifest.json", sha256: digest(readFileSync(resolve(projectRoot, "web/generated/manifest.json"))) }]) {
        const relative = "web/generated/" + asset.path;
        assert.ok(packedFiles.has(relative), "npm pack includes " + relative);
        const expected = digest(readFileSync(resolve(projectRoot, relative)));
        const installed = digest(readFileSync(join(prefix, "node_modules/concept-discovery", relative)));
        assert.equal(expected, asset.sha256, "asset manifest fingerprint: " + asset.path);
        assert.equal(installed, expected, "installed asset: " + asset.path);
        const response = await fetch(url + "/ui/" + asset.path);
        assert.equal(response.status, 200, "published asset: " + asset.path);
        const published = digest(Buffer.from(await response.arrayBuffer()));
        assert.equal(published, expected, "Docker HTTP asset: " + asset.path);
        assets[asset.path] = { expectedHash: expected, installedHash: installed, publishedHash: published };
      }
      record("packaged-cli", { package: packed.filename, shasum: packed.shasum, unrelatedWorkingDirectory: dir, assets });
      return cliPath;
    };
    const cli = async (command, input, expectedOK = true) => {
      const path = await packageCLI();
      const child = exec(process.execPath, [path, command], { cwd: dir, env: { ...process.env, CONCEPT_DISCOVERY_CONFIG: join(root, "client.json") }, maxBuffer: 8 * 1024 * 1024 });
      child.child.stdin.end(JSON.stringify(input));
      try {
        const output = await child;
        if (!expectedOK) throw new Error("Expected CLI failure: " + command);
        return JSON.parse(output.stdout).data;
      } catch (error) {
        if (expectedOK) throw error;
        return JSON.parse(error.stderr).error;
      }
    };
    const finish = async passed => {
      try { await finishAcceptance(evidence, passed, { inputs: sourceFiles, cleanup, persist }); }
      finally { removeSignals(); console.log(`EVIDENCE ${evidencePath}`); }
    };
    return { dir, root, url, token, accessCode, name, port, call, cli, kernel, core, record, evidence, evidencePath, persist, finish, cleanup: async () => { try { await cleanup(); } finally { removeSignals(); } }, detach: removeSignals, restart: async () => { await docker([...compose, "restart"]); await waitReady(); } };
  } catch (error) {
    if (evidence) { evidence.result = signalling ? "interrupted" : "failed"; evidence.error = redact(error.stack ?? error, secrets); }
    const failures = [error];
    try { await recover(); } catch (cleanupError) { failures.push(cleanupError); }
    removeSignals();
    try { persist(); } catch (persistError) { failures.push(persistError); }
    if (failures.length > 1) throw new AggregateError(failures, failures.map(value => value.message).join("; "));
    throw error;
  }
}
