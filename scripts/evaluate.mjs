import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { evaluateDataset } from "../eval/harness.mjs";

const options = { cases: "eval/cases.synthetic.json", baseUrl: "http://127.0.0.1:4173", output: ".local/eval-report.json" };
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]?.replace(/^--/, "");
  if (!Object.hasOwn(options, key) || !process.argv[index + 1]) throw new Error("Use --cases PATH --baseUrl LOCAL_URL --output PATH");
  options[key] = process.argv[index + 1];
}
const dataset = JSON.parse(readFileSync(options.cases, "utf8"));
const report = await evaluateDataset(dataset, { baseUrl: options.baseUrl });
mkdirSync(dirname(options.output), { recursive: true });
writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
chmodSync(options.output, 0o600);
console.log(`Eval ${report.dataset_kind}: ${report.evaluated_count}/${report.case_count} cases evaluated, ${report.error_count} errors; report: ${options.output}`);
for (const [name, metric] of Object.entries(report.metrics)) console.log(`${name}: ${metric.numerator}/${metric.denominator}${metric.value === null ? " (N/A)" : ` = ${metric.value.toFixed(3)}`}`);
if (report.error_count) process.exitCode = 2;
