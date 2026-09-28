import { createInterface } from "node:readline/promises";
import { saveDeepseekConfig } from "../server/model-config.mjs";
import { readSecret } from "./terminal-secret.mjs";

if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Run npm run model:configure in an interactive terminal");
const rl = createInterface({ input: process.stdin, output: process.stdout });
let choice;
let model;
try {
  console.log("The selected DeepSeek model sends the task, context, response and compact Concept cards to api.deepseek.com when you explicitly request a recommendation.");
  choice = (await rl.question("Type deepseek to choose this remote model: ")).trim();
  if (choice === "deepseek") model = (await rl.question("DeepSeek model ID [deepseek-flash]: ")).trim() || "deepseek-flash";
} finally { rl.close(); }
if (choice !== "deepseek") {
  console.log("Model configuration cancelled. No remote request will be made.");
  process.exit(0);
}
const apiKey = await readSecret("DeepSeek API key (hidden): ");
saveDeepseekConfig(apiKey, { model });
console.log(`DeepSeek model ${model} configured in ignored .env. Recommendations can now use the selected remote model.`);
