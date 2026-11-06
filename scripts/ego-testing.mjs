import { copyFileSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runtime, readRun, runPath } from "../tests/service/runtime.mjs";
import { egoCheckpoints, evidenceArtifact, verifyEgo, updateRun, sourceFiles } from "./acceptance.mjs";

export function parseArguments(args) {
  const [command, ...values] = args;
  if (!["start", "record", "cleanup", "verify", "status"].includes(command)) throw new Error("Use start, record, cleanup, verify or status");
  const options = {};
  for (let i = 0; i < values.length;) {
    if (values[i] === "--require-complete" && command === "status" && !options[values[i]]) { options[values[i++]] = true; continue; }
    if (!["--run", "--checkpoint", "--input", "--browser-finished"].includes(values[i]) || !values[i + 1] || options[values[i]]) throw new Error("Invalid or repeated option: " + values[i]);
    options[values[i]] = values[i + 1];
    i += 2;
  }
  if (command !== "start" && !options["--run"]) throw new Error("An explicit --run ID is required");
  if (command === "start" && values.length) throw new Error("start does not accept run options");
  if (command === "record" && !egoCheckpoints.includes(options["--checkpoint"])) throw new Error("Unknown --checkpoint; use " + egoCheckpoints.join(", "));
  return { command, options };
}

export function checkpointStatus(run, requireComplete = false) {
  const observed = egoCheckpoints.filter(key => run.checkpoints?.[key]?.status === "passed");
  const missing = egoCheckpoints.filter(key => !observed.includes(key));
  const unexpected = Object.keys(run.checkpoints ?? {}).filter(key => !egoCheckpoints.includes(key));
  const complete = !missing.length && !unexpected.length && run.result === "passed";
  const result = { runId: run.runId, observedCount: observed.length, requiredCount: egoCheckpoints.length, missing, unexpected, result: run.result, checkpointsComplete: complete };
  if (requireComplete && !complete) throw new Error("Ego checkpoint assertion failed: " + JSON.stringify(result));
  return result;
}

function assertRecordingOpen(run) {
  if (run.label !== "ego" || run.cleaned || run.closing || run.cleanup?.status === "running" || ["failed", "interrupted"].includes(run.result)) throw new Error("Observations require an open live ego run");
}

export function recordCheckpoint(runId, checkpoint, input) {
  const run = readRun(runId);
  assertRecordingOpen(run);
  if (!egoCheckpoints.includes(checkpoint)) throw new Error("Unknown ego checkpoint");
  if (input.status !== "passed" || !input.expected?.trim() || !input.observation?.trim() || !input.actual || typeof input.actual !== "object" || !Object.keys(input.actual).length || !Number.isInteger(input.spaceId) || input.spaceId < 1) throw new Error("Record needs passed status, expected, observation, actual fields and an ego spaceId");
  if (new URL(input.url).origin !== run.url) throw new Error("Observed URL must belong to this run");
  if (!Array.isArray(input.artifacts) || !input.artifacts.length) throw new Error("Saved browser and readback artifacts are required");
  const directory = dirname(runPath(runId));
  const artifactDirectory = join(directory, "artifacts");
  mkdirSync(artifactDirectory, { recursive: true, mode: 0o700 });
  const artifacts = input.artifacts.map((artifact, index) => {
    const source = realpathSync(resolve(artifact.path));
    const destination = join(artifactDirectory, checkpoint + "-" + index + "-" + basename(source));
    if (source !== destination) copyFileSync(source, destination);
    return evidenceArtifact(destination, artifact.kind, directory);
  });
  const updated = updateRun(runPath(runId), current => {
    assertRecordingOpen(current);
    if (current.url !== run.url) throw new Error("Acceptance origin changed while recording");
    current.checkpoints ??= {};
    current.checkpoints[checkpoint] = { status: input.status, expected: input.expected, observation: input.observation, actual: input.actual, url: input.url, spaceId: input.spaceId, recordedAt: new Date().toISOString(), artifacts };
    current.result = egoCheckpoints.every(key => current.checkpoints[key]?.status === "passed") ? "passed" : "incomplete";
    return current;
  });
  return { runId, checkpoint, recorded: true, remaining: egoCheckpoints.filter(key => !updated.checkpoints[key]) };
}

export async function main(args = process.argv.slice(2)) {
  const { command, options } = parseArguments(args);
  const runId = options["--run"];
  if (command === "start") {
    const instance = await runtime("ego");
    instance.evidence.result = "incomplete";
    instance.persist();
    instance.detach();
    return { runId: instance.name, url: instance.url, evidencePath: instance.evidencePath, accessCodePath: join(instance.root, "access-code"), clientConfigPath: join(instance.root, "client.json"), checkpoints: egoCheckpoints };
  }
  if (command === "record") {
    const input = JSON.parse(readFileSync(options["--input"] ?? 0, "utf8"));
    return recordCheckpoint(runId, options["--checkpoint"], input);
  }
  if (command === "status") return checkpointStatus(readRun(runId), options["--require-complete"] === true);
  if (command === "cleanup") {
    const before = readRun(runId);
    if (options["--browser-finished"]) {
      const directory = dirname(runPath(runId));
      const destination = join(directory, "browser-finished.json");
      const source = realpathSync(resolve(options["--browser-finished"]));
      if (source !== destination) copyFileSync(source, destination);
      const browserFinished = evidenceArtifact(destination, "browser-finished", directory);
      updateRun(runPath(runId), current => ({ ...current, browserFinished }));
    }
    if (before.cleaned) return { runId, cleaned: true, cleanup: before.cleanup };
    const instance = await runtime("ego", { resume: runId, build: false, ready: false });
    let failure;
    try {
      instance.evidence.source.endFiles = sourceFiles();
      instance.evidence.source.changedDuringRun = JSON.stringify(instance.evidence.source.files) !== JSON.stringify(instance.evidence.source.endFiles);
      if (instance.evidence.source.changedDuringRun) { instance.evidence.result = "failed"; failure = new Error("Acceptance source inputs changed during the ego run"); }
      instance.evidence.completedAt = new Date().toISOString();
    } finally { await instance.cleanup(); }
    if (failure) throw failure;
    return { runId, cleaned: true, cleanup: instance.evidence.cleanup };
  }
  const run = readRun(runId);
  const result = verifyEgo(run, dirname(runPath(runId)));
  if (!result.valid) throw new Error(result.errors.join("\n"));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(result => process.stdout.write(JSON.stringify(result, null, 2) + "\n")).catch(error => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
}
