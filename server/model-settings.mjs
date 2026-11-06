import { readFileSync } from "node:fs";
import { fail, save } from "../lib/siyuan.mjs";
import { loadModelConfig } from "./model.mjs";

function profile(input, apiKey) {
  return loadModelConfig({ ...input, apiKeyFile: "configured" }, () => apiKey);
}

export function createModelSettings(path, fallback) {
  let current = fallback;
  try {
    const stored = JSON.parse(readFileSync(path, "utf8"));
    current = profile(stored, stored.apiKey) ?? null;
  } catch (error) {
    if (error.code !== "ENOENT") current = null;
  }

  function view() {
    if (!current) return { configured: false, baseUrl: "", model: "", maxTokenField: "max_completion_tokens" };
    return {
      configured: true,
      baseUrl: current.url.slice(0, -"/chat/completions".length),
      model: current.model,
      maxTokenField: current.maxTokenField,
    };
  }

  return {
    current: () => current,
    view,
    update(input) {
      const { baseUrl, model, maxTokenField, apiKey = "" } = input;
      if (typeof baseUrl !== "string" || baseUrl.length > 2000 ||
          typeof model !== "string" || model.length > 200 || /[\r\n]/.test(model) ||
          typeof apiKey !== "string" || apiKey.length > 4096 || /[^\x21-\x7e]/.test(apiKey.trim())) {
        fail("invalid_model_settings", "请检查接口地址、模型名和 API 密钥。");
      }
      const fields = { baseUrl: baseUrl.trim(), model: model.trim(), maxTokenField };
      const normalized = profile(fields, "placeholder");
      if (!normalized) fail("invalid_model_settings", "请输入有效的接口地址和模型名。远程接口需要 HTTPS。");
      const key = apiKey.trim() || (normalized.url === current?.url ? current.apiKey : "");
      if (!key) fail("invalid_model_settings", "首次配置或更换接口地址时，请输入该接口的 API 密钥。");
      const next = profile(fields, key);
      try {
        save(path, { ...fields, apiKey: key });
      } catch {
        fail("model_settings_write_failed", "无法保存模型设置，请检查服务配置目录的写入权限。");
      }
      current = next;
      return view();
    },
  };
}
