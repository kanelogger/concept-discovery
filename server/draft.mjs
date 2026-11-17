import { randomUUID } from "node:crypto";
import { fail } from "../lib/siyuan.mjs";

export const draftErrors = Object.freeze({
  draft_unavailable: [503, "模型服务尚未配置或暂时不可用；原文已保留。"],
  draft_invalid_output: [502, "模型草稿无法核对，请重新生成。"],
  draft_read_failed: [502, "暂时无法读取草稿所需的资料，请稍后重试。"],
  draft_timeout: [504, "生成草稿超时，请重试。"],
  draft_busy: [429, "已有草稿正在生成，请稍后重试。"],
  draft_cancelled: [499, "本次草稿生成已取消。"],
  draft_session_expired: [401, "访问已过期，请重新登录。"],
});
const stop = code => Object.assign(new Error(draftErrors[code][1]), { code });
const inputErrors = new Set(["invalid_input", "input_too_large", "content_conflict", "identity_conflict", "outside_scope", "not_found", "unsupported_structure"]);

/** One bounded model request at a time; no draft persistence or write coordination. */
export function createDraftRunner({ timeoutMs = 90000, log = entry => console.log(JSON.stringify(entry)) } = {}) {
  let active;
  return {
    revoke(session) {
      if (session && active?.session === session) active.controller.abort(stop("draft_session_expired"));
    },
    async run({ session, expiresAt, clientSignal = new AbortController().signal, model }, generate) {
      if (!model) fail("draft_unavailable", draftErrors.draft_unavailable[1]);
      if (active) fail("draft_busy", draftErrors.draft_busy[1]);
      const controller = new AbortController();
      const run = { session, controller };
      active = run;
      const signal = AbortSignal.any([clientSignal, controller.signal]);
      const expiry = expiresAt === undefined ? undefined : setTimeout(
        () => controller.abort(stop("draft_session_expired")), Math.max(0, expiresAt - Date.now()),
      );
      const timeout = setTimeout(() => controller.abort(stop("draft_timeout")), timeoutMs);
      const start = Date.now();
      const metrics = { event: "wiki-draft", requestId: randomUUID(), modelCalls: 0, promptTokens: 0, completionTokens: 0, modelEvents: [] };
      const complete = async request => {
        signal.throwIfAborted();
        metrics.modelCalls++;
        const result = await model({ ...request, signal, onDiagnostic: entry => metrics.modelEvents.push(entry) });
        metrics.promptTokens += result.promptTokens ?? 0;
        metrics.completionTokens += result.completionTokens ?? 0;
        return result.value;
      };
      let onAbort;
      try {
        signal.throwIfAborted();
        // Kernel reads may not implement cancellation. Stop waiting and release
        // this read-only request; its late result cannot enter a newer request.
        const cancelled = new Promise((_, reject) => {
          onAbort = () => reject(signal.reason);
          signal.addEventListener("abort", onAbort, { once: true });
        });
        const result = await Promise.race([generate({ complete, signal }), cancelled]);
        signal.throwIfAborted();
        return result;
      } catch (error) {
        const cause = signal.aborted ? signal.reason : error;
        if (!signal.aborted && inputErrors.has(cause?.code)) { metrics.error = cause.code; throw cause; }
        const code = clientSignal.aborted ? "draft_cancelled" : Object.hasOwn(draftErrors, cause?.code) ? cause.code : "draft_read_failed";
        metrics.error = code;
        throw stop(code);
      } finally {
        clearTimeout(expiry);
        clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
        if (active === run) active = undefined;
        log({ ...metrics, durationMs: Date.now() - start });
      }
    },
  };
}
