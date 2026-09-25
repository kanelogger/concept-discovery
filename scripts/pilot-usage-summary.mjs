import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { summarizePilotUsage } from "../eval/summarize-pilot-usage.mjs";

const options = { db: "", manifest: "", output: ".local/private-pilot/usage-summary.json", asOf: new Date().toISOString() };
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]?.replace(/^--/, "");
  if (!Object.hasOwn(options, key) || !process.argv[index + 1]) throw new Error("Use --db PATH --manifest PATH [--asOf ISO_TIME] [--output PATH]");
  options[key] = process.argv[index + 1];
}
if (!options.db || !options.manifest) throw new Error("Pilot database and run manifest are required");
const manifest = JSON.parse(readFileSync(options.manifest, "utf8"));
const result = summarizePilotUsage(options.db, manifest, { asOf: options.asOf });
mkdirSync(dirname(options.output), { recursive: true });
writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
chmodSync(options.output, 0o600);
console.log(`Pilot Usage: ${result.status}; ${result.runs_total} declared real runs; ${options.output}`);
console.log(`cn ${result.locales.cn.runs}, en ${result.locales.en.runs}; closed recommendation pairs ${result.feedback.closed_recommendation_pairs}, applied ${result.feedback.applied_pairs}`);
if (result.status !== "numeric_passed") process.exitCode = 2;
