import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, inflateSync } from "node:zlib";

export const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
export const egoCheckpoints = ["sign-in", "authoring", "navigation", "compatibility", "agent-roundtrip", "desktop"];
export const digest = value => createHash("sha256").update(typeof value === "string" || ArrayBuffer.isView(value) ? value : JSON.stringify(value)).digest("hex");
export const sameInputs = (left, right) => JSON.stringify(left) === JSON.stringify(right);
export const writeJSON = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });

// Mutations are short and synchronous: signal handlers run after the lock is released.
// A same-directory rename keeps readers from seeing a partially written report.
export function updateRun(path, mutate) {
  const lock = path + ".lock";
  const deadline = Date.now() + 5000;
  const wait = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try {
      mkdirSync(lock, { mode: 0o700 });
      try { writeJSON(join(lock, "owner.json"), { pid: process.pid }); }
      catch (error) { rmSync(lock, { recursive: true, force: true }); throw error; }
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const owner = JSON.parse(readFileSync(join(lock, "owner.json"), "utf8"));
        if (Number.isInteger(owner.pid) && owner.pid > 0) {
          try { process.kill(owner.pid, 0); }
          catch (probe) { if (probe.code === "ESRCH") { rmSync(lock, { recursive: true, force: true }); continue; } }
        }
      } catch (probe) { if (!["ENOENT", "ENOTDIR"].includes(probe.code)) throw probe; }
      if (Date.now() >= deadline) throw new Error("Acceptance update lock unavailable; recovery metadata retained at " + lock);
      Atomics.wait(wait, 0, 0, 10);
    }
  }
  const temporary = path + "." + process.pid + "-" + randomBytes(5).toString("hex") + ".tmp";
  try {
    const current = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
    const next = mutate(current);
    writeJSON(temporary, next);
    renameSync(temporary, path);
    return next;
  } finally {
    rmSync(temporary, { force: true });
    rmSync(lock, { recursive: true, force: true });
  }
}

export function createRunWriter(path, state) {
  const clone = value => JSON.parse(JSON.stringify(value));
  let baseline = existsSync(path) ? clone(state) : null;
  const ownedFields = ["source", "cleaned", "closing", "cleanup", "completedAt", "error", "failure", "result", "stackMayExist"];
  return () => {
    const patch = {};
    if (baseline) for (const key of ownedFields) if (!sameInputs(state[key], baseline[key])) patch[key] = state[key];
    const records = baseline ? (state.records ?? []).slice(baseline.records?.length ?? 0) : [];
    for (const record of records) record.recordId ??= randomBytes(10).toString("hex");
    const next = updateRun(path, current => {
      if (!baseline) {
        if (current) throw new Error("Acceptance run identity already exists");
        return clone(state);
      }
      if (!current || current.runId !== state.runId) throw new Error("Acceptance run identity changed");
      Object.assign(current, patch);
      current.records ??= [];
      const known = new Set(current.records.map(record => record.recordId).filter(Boolean));
      current.records.push(...records.filter(record => !known.has(record.recordId)));
      return current;
    });
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, next);
    baseline = clone(state);
  };
}

export function sourceFiles(root = repositoryRoot) {
  const files = {};
  const visit = path => {
    const absolute = resolve(root, path);
    if (!existsSync(absolute)) { files[path] = null; return; }
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error("Acceptance input cannot be a symlink: " + path);
    if (stat.isDirectory()) for (const name of readdirSync(absolute).sort()) {
      if ([".local", "node_modules", "test-results", "playwright-report", "coverage"].includes(name)) continue;
      visit(path + "/" + name);
    }
    else if (stat.isFile()) files[path] = digest(readFileSync(absolute));
  };
  for (const path of ["bin", "lib", "server", "web", "deploy", "tests", "scripts", "package.json", "package-lock.json", "jsconfig.json", ".node-version", ".dockerignore"]) visit(path);
  return files;
}

export function environmentSnapshot(run = execFileSync) {
  const version = (command, args) => run(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 }).trim();
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    npm: version("npm", ["--version"]),
    docker: version("docker", ["version", "--format", "{{.Client.Version}}/{{.Server.Version}}"]),
    compose: version("docker", ["compose", "version", "--short"]),
    playwright: JSON.parse(readFileSync(new URL("../node_modules/@playwright/test/package.json", import.meta.url))).version,
    kernelImage: readFileSync(new URL("../deploy/compose.yaml", import.meta.url), "utf8").match(/image:\s*(\S+)/)?.[1],
  };
}

export function assertOwnedRun(run, root = repositoryRoot) {
  if (run.schema !== 2 || !/^cd-service-[a-f0-9]{10}$/.test(run.project) || run.runId !== run.project) throw new Error("Invalid acceptance run identity");
  if (realpathSync(run.repositoryRoot) !== realpathSync(root)) throw new Error("Acceptance run belongs to another repository");
  if (!isAbsolute(run.privateDirectory) || !isAbsolute(run.configurationRoot) || dirname(run.configurationRoot) !== run.privateDirectory || !/^cd-service-/.test(run.privateDirectory.split(sep).at(-1))) throw new Error("Invalid acceptance resource paths");
  const origin = new URL(run.url);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.port !== String(run.port) || origin.pathname !== "/") throw new Error("Invalid acceptance origin");
  if (existsSync(run.privateDirectory)) {
    const marker = JSON.parse(readFileSync(join(run.privateDirectory, ".acceptance-owner.json"), "utf8"));
    if (marker.runId !== run.runId || marker.repositoryRoot !== run.repositoryRoot) throw new Error("Acceptance directory owner marker does not match");
  } else if (!run.cleaned) throw new Error("Acceptance recovery directory is missing");
}

export function resourceCommands(project) {
  if (!/^cd-service-[a-f0-9]{10}$/.test(project)) throw new Error("Refusing an unowned Compose project");
  const label = "label=com.docker.compose.project=" + project;
  return {
    containers: ["ps", "-a", "--filter", label, "--format", "{{.Names}}"],
    volumes: ["volume", "ls", "--filter", label, "--format", "{{.Name}}"],
    networks: ["network", "ls", "--filter", label, "--format", "{{.Name}}"],
  };
}

// A failed attempt stays retryable. Share an in-flight cleanup across finish and signals.
export function cleanupCoordinator(run, operations) {
  let pending;
  return () => {
    if (pending) return pending;
    if (run.cleaned === true && run.cleanup?.status === "passed") return Promise.resolve();
    pending = (async () => {
      run.cleaned = false;
      run.closing = true;
      run.cleanup = { status: "running", attemptedAt: new Date().toISOString() };
      let publicationError;
      try {
        try { operations.persist(); } catch (error) { publicationError = error.message; }
        await operations.stopChildren();
        await operations.stopStack();
        const resources = {};
        for (const kind of ["containers", "volumes", "networks"]) {
          resources[kind] = await operations.list(kind);
          if (!Array.isArray(resources[kind]) || resources[kind].some(item => typeof item !== "string" || !item.trim())) throw new Error("Invalid resource inspection: " + kind);
        }
        if (Object.values(resources).some(items => items.length)) throw new Error("Owned Docker resources remain: " + JSON.stringify(resources));
        await operations.removeImage();
        await operations.removeDirectory();
        run.cleaned = true;
        run.cleanup = { status: "passed", completedAt: new Date().toISOString(), resources };
      } catch (error) {
        run.cleanup = { status: "failed", error: error.message, recoveryDirectory: run.privateDirectory };
        throw error;
      } finally {
        pending = null;
        if (publicationError) run.cleanup.publicationError = publicationError;
        operations.persist();
      }
    })();
    return pending;
  };
}

export async function finishAcceptance(run, passed, operations) {
  const failures = [];
  run.result = passed ? "passed" : "failed";
  run.completedAt = new Date().toISOString();
  try {
    run.source.endFiles = operations.inputs();
    run.source.changedDuringRun = !sameInputs(run.source.files, run.source.endFiles);
    if (run.source.changedDuringRun) throw new Error("Acceptance inputs changed during the run");
  } catch (error) { run.result = "failed"; failures.push(error); }
  try { await operations.cleanup(); } catch (error) { run.result = "failed"; failures.push(error); }
  try { operations.persist(); } catch (error) { run.result = "failed"; failures.push(error); }
  if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join("; "));
}

function pngDimensions(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!bytes.subarray(0, 8).equals(signature)) throw new Error("Evidence screenshot is not a PNG");
  let offset = 8;
  let header, palette, ended = false, dataEnded = false;
  const compressed = [];
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) throw new Error("Truncated PNG chunk");
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) throw new Error("Invalid PNG chunk length");
    if (!bytes.subarray(offset + 4, offset + 8).every(byte => (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122))) throw new Error("Invalid PNG chunk type bytes");
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || type[2] !== type[2].toUpperCase()) throw new Error("Invalid PNG chunk type");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if ((crc32(bytes.subarray(offset + 4, offset + 8 + length)) >>> 0) !== bytes.readUInt32BE(offset + 8 + length)) throw new Error("PNG chunk CRC mismatch: " + type);
    if (!header && type !== "IHDR") throw new Error("PNG must begin with IHDR");
    if (type === "IHDR") {
      if (header || length !== 13) throw new Error("Invalid PNG IHDR");
      header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!header.width || !header.height || header.width > 32768 || header.height > 32768 || !depths[header.color]?.includes(header.depth) || data[10] !== 0 || data[11] !== 0 || header.interlace > 1) throw new Error("Unsupported or invalid PNG image header");
    } else if (type === "PLTE") {
      if (palette || compressed.length || !length || length % 3 || length > 768 || [0, 4].includes(header.color)) throw new Error("Invalid PNG palette");
      palette = length / 3;
      if (header.color === 3 && palette > 2 ** header.depth) throw new Error("PNG palette exceeds its bit depth");
    } else if (type === "IDAT") {
      if (dataEnded || (header.color === 3 && !palette)) throw new Error("Invalid PNG image data order");
      compressed.push(data);
    } else {
      if (compressed.length) dataEnded = true;
      if (type === "IEND") {
        if (length || !compressed.length || offset + 12 !== bytes.length) throw new Error("Invalid PNG IEND or trailing bytes");
        ended = true;
      } else if (type[0] === type[0].toUpperCase()) throw new Error("Unknown critical PNG chunk: " + type);
    }
    offset += 12 + length;
    if (ended) break;
  }
  if (!header || !ended) throw new Error("PNG needs complete IHDR, IDAT and IEND chunks");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.color];
  const bitsPerPixel = channels * header.depth;
  const bytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const pattern = header.interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  const passes = pattern.map(([x, y, dx, dy]) => ({ width: Math.max(0, Math.ceil((header.width - x) / dx)), height: Math.max(0, Math.ceil((header.height - y) / dy)) })).filter(pass => pass.width && pass.height);
  for (const pass of passes) pass.rowBytes = Math.ceil(pass.width * bitsPerPixel / 8);
  const expected = passes.reduce((sum, pass) => sum + (pass.rowBytes + 1) * pass.height, 0);
  if (expected > 128 * 1024 * 1024) throw new Error("PNG image exceeds evidence decoding limit");
  let decoded;
  const compressedBytes = Buffer.concat(compressed);
  try {
    const result = inflateSync(compressedBytes, { maxOutputLength: expected, info: true });
    if (result.engine.bytesWritten !== compressedBytes.length) throw new Error("trailing compressed bytes");
    decoded = result.buffer;
  }
  catch (error) { throw new Error("PNG image data cannot be decoded: " + error.message); }
  if (decoded.length !== expected) throw new Error("PNG decoded scanline length differs from its image dimensions");
  let cursor = 0;
  for (const pass of passes) {
    let previous = Buffer.alloc(pass.rowBytes);
    for (let y = 0; y < pass.height; y++) {
      const filter = decoded[cursor++];
      if (filter > 4) throw new Error("Invalid PNG scanline filter");
      const row = Buffer.allocUnsafe(pass.rowBytes);
      for (let x = 0; x < row.length; x++) {
        const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
        const above = previous[x];
        const corner = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
        let predictor = 0;
        if (filter === 1) predictor = left;
        else if (filter === 2) predictor = above;
        else if (filter === 3) predictor = Math.floor((left + above) / 2);
        else if (filter === 4) {
          const p = left + above - corner;
          const distances = [Math.abs(p - left), Math.abs(p - above), Math.abs(p - corner)];
          predictor = distances[0] <= distances[1] && distances[0] <= distances[2] ? left : distances[1] <= distances[2] ? above : corner;
        }
        row[x] = (decoded[cursor++] + predictor) & 255;
      }
      if (header.color === 3) for (let x = 0; x < pass.width; x++) {
        const bit = x * header.depth;
        const index = (row[Math.floor(bit / 8)] >> (8 - header.depth - bit % 8)) & ((1 << header.depth) - 1);
        if (index >= palette) throw new Error("PNG pixel references a missing palette entry");
      }
      previous = row;
    }
  }
  return { width: header.width, height: header.height };
}

export function evidenceArtifact(path, kind, root) {
  const absolute = resolve(root, path);
  const local = relative(realpathSync(root), realpathSync(absolute));
  if (!local || local.startsWith(".." + sep) || local === ".." || isAbsolute(local)) throw new Error("Evidence artifact escapes its run directory");
  const bytes = readFileSync(absolute);
  if (kind === "screenshot") {
    return { path: local, kind, sha256: digest(bytes), ...pngDimensions(bytes) };
  }
  if (!["readback", "snapshot", "browser-finished"].includes(kind)) throw new Error("Unknown evidence artifact kind");
  const value = JSON.parse(bytes);
  if (kind === "browser-finished" && (!Number.isInteger(value.spaceId) || value.spaceId < 1 || !Number.isFinite(Date.parse(value.finishedAt)) || value.result !== "resolved")) throw new Error("Browser completion needs spaceId, finishedAt and the resolved task.finish result");
  if (kind === "snapshot" && (typeof value.url !== "string" || typeof value.snapshot !== "string" || !value.snapshot.trim())) throw new Error("Page snapshot needs its observed URL and nonempty snapshot text");
  if (kind === "readback" && (typeof value.runId !== "string" || typeof value.url !== "string" || typeof value.command !== "string" || !value.result || typeof value.result !== "object")) throw new Error("Readback needs runId, URL, command and an independent response object");
  return { path: local, kind, sha256: digest(bytes) };
}

export function verifyEgo(run, directory, { files = sourceFiles(), environment = environmentSnapshot(), root = repositoryRoot } = {}) {
  const errors = [];
  try { assertOwnedRun(run, root); } catch (error) { errors.push(error.message); }
  if (run.label !== "ego") errors.push("The specified run is not an ego acceptance run");
  if (run.result !== "passed") errors.push("Ego observations have not passed");
  if (run.cleaned !== true || run.cleanup?.status !== "passed") errors.push("Ego resources have not been verified clean");
  if (run.cleanup?.publicationError) errors.push("Cleanup closing state could not be published: " + run.cleanup.publicationError);
  if (existsSync(run.privateDirectory ?? "")) errors.push("Ego temporary directory still exists");
  if (["containers", "volumes", "networks"].some(kind => !Array.isArray(run.cleanup?.resources?.[kind]) || run.cleanup.resources[kind].length)) errors.push("Ego Docker resource inspection is incomplete or not empty");
  if (!sameInputs(run.source?.files, files) || !sameInputs(run.source?.files, run.source?.endFiles)) errors.push("Acceptance source inputs do not match the current worktree");
  if (!sameInputs(run.source?.environment, environment)) errors.push("Acceptance environment does not match");
  const spaces = new Set(Object.values(run.checkpoints ?? {}).map(record => record.spaceId));
  if (spaces.size !== 1) errors.push("Ego checkpoints must belong to one task space");
  try {
    if (!run.browserFinished) throw new Error("Ego TaskSpace completion evidence is missing");
    const artifact = evidenceArtifact(run.browserFinished.path, "browser-finished", directory);
    if (!sameInputs(artifact, run.browserFinished)) throw new Error("Ego TaskSpace completion fingerprint differs");
    const completion = JSON.parse(readFileSync(resolve(directory, artifact.path), "utf8"));
    const finishedAt = Date.parse(completion.finishedAt);
    const observedAt = Object.values(run.checkpoints ?? {}).map(record => Date.parse(record.recordedAt));
    if (!spaces.has(completion.spaceId) || !Number.isFinite(Date.parse(run.startedAt)) || !Number.isFinite(Date.parse(run.cleanup?.completedAt)) || observedAt.some(time => !Number.isFinite(time) || time > finishedAt) || finishedAt < Date.parse(run.startedAt) || finishedAt > Date.parse(run.cleanup.completedAt)) throw new Error("Ego TaskSpace completion does not match the observed space and acceptance time window");
  } catch (error) { errors.push(error.message); }
  for (const checkpoint of egoCheckpoints) {
    const record = run.checkpoints?.[checkpoint];
    if (!record || record.status !== "passed" || typeof record.observation !== "string" || !record.observation.trim() || typeof record.expected !== "string" || !record.expected.trim() || !record.actual || typeof record.actual !== "object" || !Object.keys(record.actual).length || !Number.isInteger(record.spaceId) || record.spaceId < 1) {
      errors.push("Missing observed ego checkpoint: " + checkpoint); continue;
    }
    try { if (new URL(record.url).origin !== run.url) errors.push("Checkpoint origin differs: " + checkpoint); } catch { errors.push("Invalid checkpoint URL: " + checkpoint); }
    const kinds = new Set();
    for (const artifact of record.artifacts ?? []) {
      try {
        const actual = evidenceArtifact(artifact.path, artifact.kind, directory);
        if (!sameInputs(actual, artifact)) throw new Error("Artifact fingerprint differs");
        if (artifact.kind !== "screenshot") {
          const content = JSON.parse(readFileSync(resolve(directory, artifact.path), "utf8"));
          if (new URL(content.url).origin !== run.url || (artifact.kind === "readback" && content.runId !== run.runId)) throw new Error("Artifact belongs to another acceptance instance");
        }
        kinds.add(artifact.kind);
      } catch (error) { errors.push(checkpoint + ": " + error.message); }
    }
    if (!kinds.has("screenshot") || !kinds.has("snapshot")) errors.push("Checkpoint needs a screenshot and observed page snapshot: " + checkpoint);
    if (["authoring", "agent-roundtrip", "compatibility"].includes(checkpoint) && !kinds.has("readback")) errors.push("Checkpoint needs independent persisted readback: " + checkpoint);
    if (checkpoint === "desktop") {
      if (typeof record.actual.browserVersion !== "string" || !record.actual.browserVersion.trim()) errors.push("Desktop checkpoint needs the actual ego browser version");
      const widths = new Set((record.artifacts ?? []).filter(item => item.kind === "screenshot").map(item => item.width));
      if (!widths.has(1280) || !widths.has(1440)) errors.push("Desktop checkpoint needs 1280 and 1440 pixel captures");
    }
  }
  return { valid: !errors.length, errors, runId: run.runId };
}
