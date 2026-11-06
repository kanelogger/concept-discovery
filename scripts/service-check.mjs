import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sourceFiles, sameInputs, verifyEgo } from "./acceptance.mjs";
import { readRun, runPath } from "../tests/service/runtime.mjs";

export function fullRunId(args, env = process.env) {
  if (env.CONCEPT_E2E_COMPONENT_ONLY === "1" || env.CONCEPT_KEEP_ACCEPTANCE === "1") throw new Error("Full acceptance rejects component-only or retained-resource modes");
  if (args.length !== 2 || args[0] !== "--ego-run" || !/^cd-service-[a-f0-9]{10}$/.test(args[1])) throw new Error("Full acceptance requires --ego-run <explicit-run-id>");
  return args[1];
}

export function runOwnedChild(command, args, { signal, stdio = "inherit" } = {}) {
  return new Promise((yes, no) => {
    if (signal?.aborted) { no(new Error("Acceptance interrupted")); return; }
    const child = spawn(command, args, { stdio, env: process.env, detached: process.platform !== "win32" });
    const abort = () => {
      if (process.platform === "win32") child.kill("SIGTERM");
      else { try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") no(error); } }
    };
    signal?.addEventListener("abort", abort, { once: true });
    child.once("error", error => { signal?.removeEventListener("abort", abort); no(error); });
    child.once("close", code => {
      signal?.removeEventListener("abort", abort);
      code === 0 && !signal?.aborted ? yes() : no(new Error("Check failed or interrupted: " + command + " " + args.join(" ")));
    });
  });
}

export async function runChecks(runId) {
  const controller = new AbortController();
  const onInt = () => controller.abort();
  const onTerm = () => controller.abort();
  process.once("SIGINT", onInt);
  process.once("SIGTERM", onTerm);
  const run = (command, args) => {
    console.log("CHECK " + command + " " + args.join(" "));
    return runOwnedChild(command, args, { signal: controller.signal });
  };
  try {
    await run(process.execPath, ["scripts/build-web.mjs"]);
    const before = sourceFiles();
    const verify = () => {
      const result = verifyEgo(readRun(runId), dirname(runPath(runId)));
      if (!result.valid) throw new Error(result.errors.join("\n"));
    };
    verify();
    for (const args of [["scripts/doctor.mjs"], ["scripts/validate.mjs"]]) await run(process.execPath, args);
    await run("npm", ["test"]);
    await run("npm", ["run", "test:integration"]);
    await run("npm", ["run", "test:browser"]);
    if (!sameInputs(before, sourceFiles())) throw new Error("Inputs changed during full acceptance");
    verify();
    console.log("PASS full acceptance: Node, real API/installed CLI, critical Playwright and observed ego user flows");
  } finally {
    process.removeListener("SIGINT", onInt);
    process.removeListener("SIGTERM", onTerm);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await runChecks(fullRunId(process.argv.slice(2))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
