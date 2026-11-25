import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config, initializeLibrary, Siyuan } from "../lib/siyuan.mjs";
import { authenticationConfig } from "../server/auth-config.mjs";
import { openServiceAuth, start } from "../server/main.mjs";

const servicePath = resolve(process.env.CONCEPT_SERVICE_CONFIG ?? ".local/knowledge/service.json");
process.env.CONCEPT_SERVICE_CONFIG = servicePath;
const service = JSON.parse(readFileSync(servicePath, "utf8"));
const authStore = openServiceAuth(authenticationConfig(service, servicePath));
try {
  const kernelPath = resolve(dirname(servicePath), service.kernelConfig);
  const kernel = config(kernelPath);
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
  if (!kernel.notebookId) await initializeLibrary(api, kernelPath);
  await api.identity();
  await start(servicePath, { authStore });
} catch (error) {
  authStore?.close();
  throw error;
}
