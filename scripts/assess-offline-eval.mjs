import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { assessOfflineEval } from "../eval/assess-offline.mjs";

const options = { cases: "eval/cases.draft.synthetic.json", report: ".local/eval-report.json", review: "", policy: "eval/thresholds.initial.json", output: ".local/eval-assessment.json" };
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]?.replace(/^--/, "");
  if (!Object.hasOwn(options, key) || !process.argv[index + 1]) throw new Error("Use --cases PATH --report PATH --review PATH --policy PATH --output PATH");
  options[key] = process.argv[index + 1];
}
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const result = assessOfflineEval(read(options.cases), read(options.report), options.review ? read(options.review) : null, read(options.policy));
mkdirSync(dirname(options.output), { recursive: true });
writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
chmodSync(options.output, 0o600);
console.log(`Offline Eval assessment: ${result.status}; ${result.case_count} cases; ${options.output}`);
if (result.status === "not_evaluable") console.log(`Missing evidence: ${result.reasons.join(", ")}`);
if (result.status === "numeric_failed") console.log(`Below threshold: ${result.failures.join(", ")}`);
if (result.status !== "numeric_passed") process.exitCode = 2;
