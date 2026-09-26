import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeepseekAdapter } from "../server/deepseek-model.mjs";
import { createApiServer } from "../server/http.mjs";
import { readSecret } from "./terminal-secret.mjs";

const apiKey = process.env.DEEPSEEK_API_KEY || await readSecret("Temporary DeepSeek API key (hidden, not saved): ");
const directory = mkdtempSync(join(tmpdir(), "concept-recommend-smoke-"));
const app = createApiServer({ dbPath: join(directory, "registry.sqlite"), modelAdapterFactory: () => createDeepseekAdapter(apiKey) });
try {
  const image = readFileSync(new URL("../tests/fixtures/red.webp", import.meta.url)).toString("base64");
  app.registry.create({ id: "inversion", domains: ["reasoning"], locales: { cn: { name: "逆向思维", description: "从失败结果倒推决策风险", source_text: "合成测试来源", trigger: ["有事实可检验的方案选择"], avoid_when: ["没有任何可验证的事实"], agent_instruction: "帮助用户倒推失败路径" }, en: { name: "Inversion", description: "Work backward from failure to inspect decision risk", source_text: "Synthetic source", trigger: ["Choosing with known facts"], avoid_when: ["No verifiable facts"], agent_instruction: "Work backward from failure" } } });
  app.registry.update("inversion", { expected_version: 1, changes: {}, media: { cn: { action: "set", data: image }, en: { action: "set", data: image } } });
  app.registry.create({ id: "premortem", domains: ["reasoning"], locales: { cn: { name: "事前验尸", description: "行动前假想失败并倒推原因", source_text: "合成测试来源", trigger: ["有事实可检验的方案选择"], avoid_when: ["没有任何可验证的事实"], agent_instruction: "帮助用户倒推失败原因" } } });
  app.registry.update("premortem", { expected_version: 1, changes: {}, media: { cn: { action: "set", data: image } } });
  app.registry.create({ id: "opportunity-cost", domains: ["reasoning"], locales: { cn: { name: "机会成本", description: "比较选择当前方案时放弃的最佳替代机会", source_text: "合成测试来源", trigger: ["存在具体替代方案"], avoid_when: ["没有可比较的替代方案"], agent_instruction: "帮助用户比较放弃的机会" } } });
  app.registry.update("opportunity-cost", { expected_version: 1, changes: {}, media: { cn: { action: "set", data: image } } });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  for (const [name, task, limit, locale] of [
    ["applicable", "我有两个已知方案，想检查选择中的明显失败风险。", 1, "cn"],
    ["low-gain", "请回答一个简单事实：2 加 2 等于几？", 1, "cn"],
    ["avoid-when", "我没有任何可验证的事实，也没有具体方案，现在还无法分析决策风险。", 1, "cn"],
    ["overlap", "我有一个具体方案，想从失败倒推风险；只需最有帮助的方法。", 3, "cn"],
    ["complementary", "我有两个具体方案与基本事实，想同时比较放弃的最佳机会和各方案可能的失败路径。", 3, "cn"],
    ["english", "I have two known options and want to inspect failure risks before choosing.", 1, "en"],
  ]) {
    const response = await fetch(`${origin}/api/recommendations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task, locale, limit }) });
    const result = await response.json();
    if (!response.ok) throw new Error(`${name} HTTP smoke returned ${response.status}: ${result.error}`);
    if (name === "overlap" && result.recommendations.length > 1) throw new Error("Overlapping Concepts were recommended together");
    if (name === "complementary" && result.recommendations.length > 2) throw new Error("Overlapping failure lenses were recommended together");
    if (name === "english" && result.recommendations.some((item) => item.name !== "Inversion")) throw new Error("English response used a wrong-locale name");
    console.log(`${name}: diagnosis=${result.diagnosis.length}, ids=${result.recommendations.map((item) => item.id).join(",") || "NONE"}`);
  }
} finally {
  await app.close();
  rmSync(directory, { recursive: true, force: true });
}
