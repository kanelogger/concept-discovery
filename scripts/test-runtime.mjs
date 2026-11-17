import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
export const digest = value => createHash("sha256").update(typeof value === "string" || ArrayBuffer.isView(value) ? value : JSON.stringify(value)).digest("hex");

// Reports and private configuration are written atomically.
export function writeJSON(path, value) {
  const temporary = path + "." + process.pid + "-" + randomBytes(5).toString("hex") + ".tmp";
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function assertOwnedRun(run, root = repositoryRoot) {
  if (run.schema !== 2 || !/^cd-service-[a-f0-9]{10}$/.test(run.project) || run.runId !== run.project) throw new Error("Invalid test run identity");
  if (realpathSync(run.repositoryRoot) !== realpathSync(root)) throw new Error("Test run belongs to another repository");
  if (!isAbsolute(run.privateDirectory) || !isAbsolute(run.configurationRoot) || dirname(run.configurationRoot) !== run.privateDirectory || !/^cd-service-/.test(run.privateDirectory.split(sep).at(-1))) throw new Error("Invalid test resource paths");
  const origin = new URL(run.url);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.port !== String(run.port) || origin.pathname !== "/") throw new Error("Invalid test origin");
  if (existsSync(run.privateDirectory)) {
    const marker = JSON.parse(readFileSync(join(run.privateDirectory, ".acceptance-owner.json"), "utf8"));
    if (marker.runId !== run.runId || marker.repositoryRoot !== run.repositoryRoot) throw new Error("Test directory owner marker does not match");
  } else if (!run.cleaned) throw new Error("Test recovery directory is missing");
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

// Share cleanup across normal completion and signals; failed cleanup remains retryable.
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

export async function finishRun(run, passed, { cleanup, persist }) {
  const failures = [];
  run.result = passed ? "passed" : "failed";
  run.completedAt = new Date().toISOString();
  try { await cleanup(); } catch (error) { run.result = "failed"; failures.push(error); }
  try { persist(); } catch (error) { run.result = "failed"; failures.push(error); }
  if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join("; "));
}
