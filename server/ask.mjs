import { randomUUID } from "node:crypto";
import { fail } from "../lib/siyuan.mjs";

export const askErrors = Object.freeze({
  invalid_ask_question: [400, "请输入 1 至 1000 个字符的问题。"],
  ask_unavailable: [503, "模型服务尚未配置或暂时不可用。可以继续用关键词搜索。"],
  ask_invalid_output: [502, "模型返回的结果无法核对。请重试，或使用关键词搜索。"],
  ask_read_failed: [502, "暂时无法读取分析所需的资料。请稍后重试。"],
  ask_timeout: [504, "本次分析超时。请重试，或使用关键词搜索。"],
  ask_busy: [429, "已有问题正在分析。请稍后重试。"],
  ask_cancelled: [499, "本次分析已取消。"],
  ask_session_expired: [401, "访问已过期，请重新登录。"],
});

const stop = code => Object.assign(new Error(askErrors[code][1]), { code });

export function createAskRunner(completeModel, { timeoutMs = 90000, log = entry => console.log(JSON.stringify(entry)) } = {}) {
  let active;
  return {
    available: Boolean(completeModel),
    revoke(session) {
      if (session && active?.session === session) active.controller.abort(stop("ask_session_expired"));
    },
    async run({ session, expiresAt, clientSignal, model = completeModel }, execute) {
      if (!model) fail("ask_unavailable", askErrors.ask_unavailable[1]);
      if (active) fail("ask_busy", askErrors.ask_busy[1]);
      const controller = new AbortController();
      active = { session, controller };
      const signal = AbortSignal.any([clientSignal, controller.signal]);
      const expiry = expiresAt === undefined ? undefined : setTimeout(
        () => controller.abort(stop("ask_session_expired")), Math.max(0, expiresAt - Date.now()),
      );
      const timeout = setTimeout(() => controller.abort(stop("ask_timeout")), timeoutMs);
      const start = Date.now();
      const metrics = { event: "ask", requestId: randomUUID(), modelCalls: 0, cards: 0, promptTokens: 0, completionTokens: 0 };
      const complete = async request => {
        signal.throwIfAborted();
        metrics.modelCalls++;
        const result = await model({ ...request, signal });
        metrics.promptTokens += result.promptTokens;
        metrics.completionTokens += result.completionTokens;
        return result.value;
      };
      try {
        signal.throwIfAborted();
        const result = await execute({ complete, signal });
        signal.throwIfAborted();
        metrics.cards = result.cards.length;
        return result;
      } catch (error) {
        const cause = signal.aborted ? signal.reason : error;
        const code = clientSignal.aborted ? "ask_cancelled" : Object.hasOwn(askErrors, cause?.code) ? cause.code : "ask_read_failed";
        metrics.error = code;
        throw stop(code);
      } finally {
        clearTimeout(expiry);
        clearTimeout(timeout);
        active = undefined;
        log({ ...metrics, durationMs: Date.now() - start });
      }
    },
  };
}
