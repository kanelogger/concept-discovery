import { recommendForSkill, composeWithLocalRegistry } from "../server/skill-flow.mjs";

const mode = process.argv[2];
if (!["recommend", "compose"].includes(mode)) {
  console.error("Usage: node scripts/skill-discovery.mjs recommend|compose < input.json");
  process.exit(2);
}
try {
  let raw = "";
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 64 * 1024) throw new Error("Skill input exceeds 64 KiB");
  }
  const input = JSON.parse(raw);
  const result = mode === "recommend" ? await recommendForSkill(input, { origin: process.env.CONCEPT_API_URL }) : composeWithLocalRegistry(input);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: error.code || "skill_failed", message: error.message || "Skill failed" })}\n`);
  process.exitCode = 1;
}
