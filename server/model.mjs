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

async function readCompletion(response) {
  const reader = response.body?.getReader();
  if (!reader) fail("ask_invalid_output", "模型结果为空。");
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1024 * 1024) fail("ask_invalid_output", "模型结果超出大小限制。");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export function chatCompletions(config, fetcher = globalThis.fetch) {
  if (!config) return null;
  return async ({ prompt, data, maxTokens, signal }) => {
    let response;
    try {
      response = await fetcher(config.url, {
        method: "POST",
        redirect: "error",
        signal,
        headers: { Authorization: "Bearer " + config.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "system", content: prompt }, { role: "user", content: JSON.stringify(data) }],
          stream: false,
          response_format: { type: "json_object" },
          [config.maxTokenField]: maxTokens,
        }),
      });
    } catch {
      signal?.throwIfAborted();
      fail("ask_unavailable", "模型服务暂时不可用。");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      fail("ask_unavailable", "模型服务暂时不可用。");
    }
    try {
      const payload = await readCompletion(response);
      const choice = payload.choices?.[0];
      if (choice?.finish_reason === "length" || choice?.finish_reason === "content_filter" ||
          choice?.message?.refusal || choice?.message?.tool_calls?.length || typeof choice?.message?.content !== "string")
        fail("ask_invalid_output", "模型未提供完整结果。");
      const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
      return {
        value: JSON.parse(choice.message.content),
        promptTokens: count(payload.usage?.prompt_tokens),
        completionTokens: count(payload.usage?.completion_tokens),
      };
    } catch {
      signal?.throwIfAborted();
      fail("ask_invalid_output", "模型返回了无法核对的结果。");
    }
  };
}
