import { fail } from "../lib/siyuan.mjs";

const tokenFields = ["max_completion_tokens", "max_tokens"];
const loopback = ["127.0.0.1", "localhost", "[::1]"];

export function loadModelConfig(profile, readSecret) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return null;
  const { baseUrl, model, apiKeyFile, maxTokenField = tokenFields[0] } = profile;
  if (![baseUrl, model, apiKeyFile].every(value => typeof value === "string" && value.trim()) ||
      !tokenFields.includes(maxTokenField)) return null;
  try {
    const url = new URL(baseUrl);
    if (url.username || url.password || url.search || url.hash ||
        (url.protocol !== "https:" && !(url.protocol === "http:" && loopback.includes(url.hostname)))) return null;
    const apiKey = readSecret(apiKeyFile);
    if (!apiKey || /[\r\n]/.test(apiKey)) return null;
    return { url: url.href.replace(/\/+$/, "") + "/chat/completions", model: model.trim(), apiKey, maxTokenField };
  } catch {
    return null;
  }
}

const invalidModel = diagnostic => Object.assign(new Error("模型返回了无法核对的结果。"), {
  code: "ask_invalid_output", diagnostic,
});

async function readCompletion(response) {
  const reader = response.body?.getReader();
  if (!reader) throw invalidModel("empty_body");
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1024 * 1024) throw invalidModel("response_limit");
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw invalidModel("envelope_json"); }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

const retryable = new Set(["blank_content", "truncated", "content_json", "queries_shape", "queries_count", "queries_text", "answer_schema", "references", "description_schema"]);
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;

export function chatCompletions(config, fetcher = globalThis.fetch) {
  if (!config) return null;
  // DeepSeek enables reasoning by default. These bounded JSON extraction tasks
  // need the output budget for the answer; don't send vendor options elsewhere.
  const directDeepSeek = new URL(config.url).hostname === "api.deepseek.com" &&
    /^(deepseek-flash|deepseek-v4-flash|deepseek-v4-pro|deepseek-chat)$/.test(config.model);
  return async ({ prompt, data, maxTokens, signal, validate = value => value, onDiagnostic = () => {} }) => {
    let budget = maxTokens, promptTokens = 0, completionTokens = 0;
    for (let attempt = 1; attempt <= 2; attempt++) {
      signal?.throwIfAborted();
      let response;
      try {
        response = await fetcher(config.url, {
          method: "POST", redirect: "error", signal,
          headers: { Authorization: "Bearer " + config.apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: config.model,
            messages: [{ role: "system", content: prompt + (attempt === 2 ? "\n上次候选已因校验失败被丢弃。仅依据原始资料重新生成完整JSON；严格遵守字段、数组与文本长度，不加其他字段。若包含cards和steps，cardId必须来自候选，每个evidenceId必须属于对应卡片，steps的引用必须已列在所选cards中。" : "") }, { role: "user", content: JSON.stringify(data) }],
            stream: false, response_format: { type: "json_object" },
            [config.maxTokenField]: budget,
            ...(directDeepSeek ? { thinking: { type: "disabled" } } : {}),
          }),
        });
      } catch {
        signal?.throwIfAborted();
        onDiagnostic({ attempt, outcome: "transport", budget });
        fail("ask_unavailable", "模型服务暂时不可用。");
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        onDiagnostic({ attempt, outcome: "http", budget });
        fail("ask_unavailable", "模型服务暂时不可用。");
      }
      let finishReason = "unknown";
      try {
        const payload = await readCompletion(response);
        signal?.throwIfAborted();
        promptTokens += count(payload?.usage?.prompt_tokens);
        completionTokens += count(payload?.usage?.completion_tokens);
        const choice = payload?.choices?.[0];
        finishReason = ["stop", "length", "content_filter", "tool_calls"].includes(choice?.finish_reason)
          ? choice.finish_reason : "unknown";
        if (finishReason === "content_filter" || choice?.message?.refusal || choice?.message?.tool_calls?.length)
          throw invalidModel("refusal");
        if (finishReason === "length") throw invalidModel("truncated");
        if (typeof choice?.message?.content !== "string") throw invalidModel("provider_envelope");
        if (!choice.message.content.trim()) throw invalidModel("blank_content");
        let value;
        try { value = JSON.parse(choice.message.content); }
        catch { throw invalidModel("content_json"); }
        value = validate(value);
        onDiagnostic({ attempt, outcome: "valid_json", budget, finishReason });
        return { value, promptTokens, completionTokens, attempts: attempt };
      } catch (error) {
        signal?.throwIfAborted();
        const diagnostic = error.code === "ask_invalid_output" ? error.diagnostic : "provider_envelope";
        onDiagnostic({ attempt, outcome: diagnostic, budget, finishReason });
        if (attempt === 2 || !retryable.has(diagnostic)) throw invalidModel(diagnostic);
        if (diagnostic === "truncated") budget = Math.min(maxTokens * 2, 8192);
      }
    }
  };
}
