import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "concept-discovery-e2e-"));
const dbPath = join(directory, "registry.sqlite");
const prepare = spawnSync(process.execPath, ["scripts/prepare-knowledge-demo.mjs", "--db", dbPath], { stdio: "inherit" });
if (prepare.status !== 0) {
  rmSync(directory, { recursive: true, force: true });
  process.exit(prepare.status ?? 1);
}

const server = spawn(process.execPath, ["server/start.mjs"], {
  env: { ...process.env, CONCEPT_DB_PATH: dbPath, PORT: "4188" },
  stdio: "inherit",
});
let stopping = false;
const stop = (signal) => {
  if (stopping) return;
  stopping = true;
  if (server.exitCode === null) server.kill(signal);
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
server.on("exit", (code, signal) => {
  rmSync(directory, { recursive: true, force: true });
  process.exitCode = code ?? (signal ? 1 : 0);
});
