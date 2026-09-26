import { createDeepseekAdapter } from "../server/deepseek-model.mjs";
import { runRecommendation } from "../server/recommendation-contract.mjs";
import { readSecret } from "./terminal-secret.mjs";

const apiKey = process.env.DEEPSEEK_API_KEY || await readSecret("Temporary DeepSeek API key (hidden, not saved): ");
const concept = {
  id: "inversion", lifecycle_status: "active", domains: ["reasoning"], intents: [], interaction_type: "lens", epistemic_type: "heuristic",
  readiness: { cn: { recommendable: true }, en: { recommendable: false } },
  locales: { cn: { name: "逆向思维", description: "从失败结果倒推决策风险", trigger: ["选择方案时"], avoid_when: ["缺少基本事实"] } },
};
const result = await runRecommendation({ task: "在两个熟悉的方案中做一个小选择，想检查明显的失败风险。", locale: "cn" }, [concept], createDeepseekAdapter(apiKey), { timeoutMs: 60_000 });
console.log(`DeepSeek smoke passed: locale=${result.locale}, diagnosis=${result.diagnosis.length}, recommendations=${result.recommendations.length}`);
