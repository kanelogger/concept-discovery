import { existsSync, lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createDeepseekAdapter, DEEPSEEK_MODEL } from "./deepseek-model.mjs";
import { RecommendationError } from "./recommendation-contract.mjs";

const fields = new Set(["CONCEPT_MODEL_PROVIDER", "CONCEPT_MODEL_REMOTE_CONSENT", "DEEPSEEK_MODEL", "DEEPSEEK_API_KEY"]);
const setupMessage = "Run npm run model:configure in a terminal before the first remote recommendation";

export function readModelSettings({ path = ".env", env = process.env } = {}) {
  const file = {};
  if (existsSync(path)) {
    if (!lstatSync(path).isFile()) throw new RecommendationError(503, "model_unavailable", "Model config must be a local regular file");
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
      if (match && fields.has(match[1])) file[match[1]] = match[2].trim().replace(/^("|')(.*)\1$/, "$2");
    }
  }
  const value = (key) => Object.hasOwn(env, key) ? env[key] : file[key];
  return { provider: value("CONCEPT_MODEL_PROVIDER") || "", consent: value("CONCEPT_MODEL_REMOTE_CONSENT") || "", model: value("DEEPSEEK_MODEL") || DEEPSEEK_MODEL, apiKey: value("DEEPSEEK_API_KEY") || "" };
}

export function configuredModelAdapter(options = {}) {
  const settings = readModelSettings(options);
  if (!settings.provider) throw new RecommendationError(503, "model_unavailable", setupMessage);
  if (settings.provider === "local") throw new RecommendationError(503, "local_model_unavailable", "No local model adapter is configured; run npm run model:configure to select DeepSeek");
  if (settings.provider !== "deepseek") throw new RecommendationError(503, "model_unavailable", "Configured model provider is unsupported");
  if (settings.consent !== "deepseek") throw new RecommendationError(503, "model_consent_required", setupMessage);
  if (!settings.apiKey) throw new RecommendationError(503, "model_unavailable", setupMessage);
  return createDeepseekAdapter(settings.apiKey, { ...options, model: settings.model });
}

export function saveDeepseekConfig(apiKey, { path = ".env", model = DEEPSEEK_MODEL } = {}) {
  if (typeof apiKey !== "string" || !/^sk-[A-Za-z0-9_-]{16,}$/.test(apiKey)) throw new TypeError("A valid DeepSeek API key is required");
  if (typeof model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(model)) throw new TypeError("A valid DeepSeek model ID is required");
  if (existsSync(path) && (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile())) throw new Error("Model config must be a local regular file");
  const existing = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/).filter((line) => !/^\s*(CONCEPT_MODEL_PROVIDER|CONCEPT_MODEL_REMOTE_CONSENT|DEEPSEEK_MODEL|DEEPSEEK_API_KEY)=/.test(line)) : [];
  const content = [...existing.filter(Boolean), "CONCEPT_MODEL_PROVIDER=deepseek", "CONCEPT_MODEL_REMOTE_CONSENT=deepseek", `DEEPSEEK_MODEL=${model}`, `DEEPSEEK_API_KEY=${apiKey}`, ""].join("\n");
  const temporary = join(dirname(path), `.concept-model-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, content, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } finally {
    // A failed rename leaves only this task's temporary file behind.
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
