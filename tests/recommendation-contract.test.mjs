import assert from "node:assert/strict";
import { test } from "node:test";
import { assembleRecommendationResult, compactCandidateCards, parseRecommendationRequest, runRecommendation, unavailableModel } from "../server/recommendation-contract.mjs";

const concept = {
  id: "inversion", lifecycle_status: "active", domains: ["reasoning"], intents: ["challenge_assumption"], interaction_type: "lens", epistemic_type: "heuristic",
  readiness: { cn: { recommendable: true }, en: { recommendable: false } },
  locales: {
    cn: { name: "逆向思维", description: "从失败倒推", trigger: ["选择受阻"], avoid_when: ["缺少基本事实"], agent_instruction: "完整的内部应用指引", cover_image: "private-cn-hash" },
    en: { name: "Inversion", description: "Think backward", trigger: ["Decision"], avoid_when: [], agent_instruction: "Private English instruction", cover_image: "private-en-hash" },
  },
};

test("recommendation request needs a task and explicit locale, with 1 to 3 result limit", () => {
  assert.deepEqual(parseRecommendationRequest({ task: "  怎样减少复杂性  ", locale: "cn" }), { task: "怎样减少复杂性", context: "", response: "", user_intent: "", locale: "cn", limit: 1 });
  assert.equal(parseRecommendationRequest({ task: "Compare options", context: "Details", response: "Current draft", user_intent: "Simplify", locale: "en", limit: 3 }).limit, 3);
  for (const input of [{ locale: "cn" }, { task: "x" }, { task: "x", locale: "auto" }, { task: "x", locale: "cn", limit: 0 }, { task: "x", locale: "cn", limit: 4 }, { task: "x", locale: "cn", context: 123 }, { task: "x", locale: "cn", hidden: true }]) {
    assert.throws(() => parseRecommendationRequest(input), { code: "invalid_recommendation_request", status: 400 });
  }
});

test("compact cards contain only eligible requested-locale text and omit instructions and images", () => {
  const cards = compactCandidateCards([concept, { ...concept, id: "archived", lifecycle_status: "archived" }], "cn");
  assert.deepEqual(cards, [{ id: "inversion", name: "逆向思维", description: "从失败倒推", trigger: ["选择受阻"], avoid_when: ["缺少基本事实"], domains: ["reasoning"], intents: ["challenge_assumption"], interaction_type: "lens", epistemic_type: "heuristic" }]);
  assert.equal(JSON.stringify(cards).includes("完整的内部应用指引"), false);
  assert.equal(JSON.stringify(cards).includes("private-cn-hash"), false);
  assert.deepEqual(compactCandidateCards([concept], "en"), []);
});

test("model decision becomes a same-locale public result, including true NONE", () => {
  const request = parseRecommendationRequest({ task: "怎样选择", locale: "cn", limit: 3 });
  assert.deepEqual(assembleRecommendationResult(request, { diagnosis: ["选择过程缺少反向检验"], recommendations: [{ id: "inversion", reason: "  可从失败倒推  ", confidence: 0.8 }] }, [concept]), {
    locale: "cn", diagnosis: ["选择过程缺少反向检验"], recommendations: [{ id: "inversion", name: "逆向思维", reason: "可从失败倒推", confidence: 0.8, card: { description: "从失败倒推", tags: [], cover_image: "private-cn-hash", interaction_type: "lens", epistemic_type: "heuristic" } }],
  });
  assert.deepEqual(assembleRecommendationResult(request, { diagnosis: [], recommendations: [] }, [concept]), { locale: "cn", diagnosis: [], recommendations: [] });
  assert.throws(() => assembleRecommendationResult(parseRecommendationRequest({ task: "Choose", locale: "en" }), { diagnosis: [], recommendations: [{ id: "inversion", reason: "Maybe", confidence: 0.5 }] }, [concept]), { code: "invalid_model_decision", status: 502 });
});

test("model output rejects hallucinated candidates, duplicates, excessive results, and invalid confidence", () => {
  const request = parseRecommendationRequest({ task: "Decide", locale: "cn", limit: 2 });
  const invalid = [
    { diagnosis: [], recommendations: [{ id: "invented", reason: "Looks useful", confidence: 0.8 }] },
    { diagnosis: [], recommendations: [{ id: "inversion", reason: "Useful", confidence: 0.8 }, { id: "inversion", reason: "Again", confidence: 0.7 }] },
    { diagnosis: [], recommendations: [{ id: "inversion", reason: "Useful", confidence: 1.2 }] },
    { diagnosis: [], recommendations: [{ id: "inversion", reason: "", confidence: 0.8 }] },
    { diagnosis: ["  "], recommendations: [] },
    { diagnosis: [], recommendations: [{ id: "inversion", name: "Invented name", reason: "Useful", confidence: 0.8 }] },
  ];
  for (const decision of invalid) assert.throws(() => assembleRecommendationResult(request, decision, [concept]), { code: "invalid_model_decision", status: 502 });
  assert.throws(() => assembleRecommendationResult(parseRecommendationRequest({ task: "Decide", locale: "cn" }), { diagnosis: [], recommendations: [{ id: "inversion", reason: "A", confidence: 0.5 }, { id: "other", reason: "B", confidence: 0.5 }] }, [concept]), { code: "invalid_model_decision", status: 502 });
  assert.throws(() => unavailableModel(), { code: "model_unavailable", status: 503 });
});

test("isolated adapter receives only compact same-locale cards and returns a checked result", async () => {
  const result = await runRecommendation({ task: "怎样选择", locale: "cn" }, [concept], {
    async decide(payload, { signal }) {
      assert.equal(signal.aborted, false);
      assert.equal(payload.request.task, "怎样选择");
      assert.deepEqual(payload.candidates, compactCandidateCards([concept], "cn"));
      assert.equal(JSON.stringify(payload).includes("完整的内部应用指引"), false);
      return { diagnosis: ["需要检验失败路径"], recommendations: [{ id: "inversion", reason: "当前选择可以反向推演", confidence: 0.75 }] };
    },
  });
  assert.equal(result.recommendations[0].name, "逆向思维");
  assert.deepEqual(await runRecommendation({ task: "Choose", locale: "en" }, [concept], { decide: async ({ candidates }) => {
    assert.deepEqual(candidates, []);
    return { diagnosis: [], recommendations: [] };
  } }), { locale: "en", diagnosis: [], recommendations: [] });
});

test("model absence, failure, timeout, and normal NONE are distinct", async () => {
  const input = { task: "Decide", locale: "cn" };
  await assert.rejects(runRecommendation(input, [concept]), { code: "model_unavailable", status: 503 });
  await assert.rejects(runRecommendation(input, [concept], { decide: async () => { throw new Error("private provider detail"); } }), { code: "model_failed", status: 502, message: "Model decision failed" });
  let timedOutSignal;
  await assert.rejects(runRecommendation(input, [concept], { decide: (_, { signal }) => { timedOutSignal = signal; return new Promise(() => {}); } }, { timeoutMs: 1 }), { code: "model_timeout", status: 504 });
  assert.equal(timedOutSignal.aborted, true);
  assert.deepEqual(await runRecommendation(input, [concept], { decide: async () => ({ diagnosis: ["无需方法"], recommendations: [] }) }), { locale: "cn", diagnosis: ["无需方法"], recommendations: [] });
});
