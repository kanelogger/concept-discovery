import { createInterface } from "node:readline/promises";
import { saveDeepseekConfig } from "../server/model-config.mjs";
import { readSecret } from "./terminal-secret.mjs";

if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Run npm run model:configure in an interactive terminal");
const rl = createInterface({ input: process.stdin, output: process.stdout });
let choice;
try {
  console.log("DeepSeek deepseek-flash sends the task, context, response and compact Concept cards to api.deepseek.com when you explicitly request a recommendation.");
  choice = (await rl.question("Type deepseek to choose this remote model: ")).trim();
} finally { rl.close(); }
if (choice !== "deepseek") {
  console.log("Model configuration cancelled. No remote request will be made.");
  process.exit(0);
}
const apiKey = await readSecret("DeepSeek API key (hidden): ");
saveDeepseekConfig(apiKey);
console.log("DeepSeek configured in ignored .env. Recommendations can now use the selected remote model.");
