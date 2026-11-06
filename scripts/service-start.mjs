import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config, Siyuan } from "../lib/siyuan.mjs";

const servicePath = resolve(process.env.CONCEPT_SERVICE_CONFIG ?? ".local/knowledge/service.json");
process.env.CONCEPT_SERVICE_CONFIG = servicePath;
const service = JSON.parse(readFileSync(servicePath, "utf8"));
const kernelPath = resolve(dirname(servicePath), service.kernelConfig);
let kernel = config(kernelPath);
const api = new Siyuan(kernel);
let ready = false;
for (let attempt = 0; attempt < 180; attempt++) {
  try {
    if ((await api.api("/api/system/bootProgress")).progress === 100) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!ready) throw new Error("Knowledge storage readiness timeout");
if (!kernel.notebookId) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../bin/maintenance.mjs", import.meta.url)), "init"], {
    env: { ...process.env, CONCEPT_DISCOVERY_CONFIG: kernelPath },
    input: JSON.stringify({ name: "Concept Discovery" }),
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error("Knowledge library initialization failed: " + result.stderr.trim());
  kernel = config(kernelPath);
}
await new Siyuan(kernel).identity();
const { start } = await import("../server/main.mjs");
await start(servicePath);
