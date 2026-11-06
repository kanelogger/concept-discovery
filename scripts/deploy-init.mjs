import { resolve, join } from "node:path";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

// Only a new private directory may be initialized; existing data is never adopted.
const args = process.argv.slice(2);
const development = args.includes("--development");
const paths = args.filter(value => value !== "--development");
if (paths.length > 1 || paths.some(value => value.startsWith("--")) || args.filter(value => value === "--development").length > 1) throw new Error("Usage: deploy-init.mjs [directory] [--development]");
const root = resolve(paths[0] ?? ".local/knowledge");
if (existsSync(root)) throw new Error("Destination exists; refusing to overwrite");
mkdirSync(join(root, "workspace/conf"), { recursive: true, mode: 0o700 });
mkdirSync(join(root, "operations"), { mode: 0o700 });
const secret = () => randomBytes(32).toString("hex");
const kernelToken = secret();
const agentToken = secret();
const accessCode = development ? "8869527" : secret();
const kernelAccess = secret();
const write = (name, value) => writeFileSync(join(root, name), value, { mode: 0o600 });
const json = (name, value) => write(name, JSON.stringify(value, null, 2) + "\n");
write("kernel-token", kernelToken + "\n");
write("agent-token", agentToken + "\n");
write("access-code", accessCode + "\n");
json("workspace/conf/conf.json", {
  api: { token: kernelToken },
  ocr: { auto: false },
  snippet: { enabledCSS: false, enabledJS: false },
  editor: { allowSVGScript: false, allowHTMLBLockScript: false },
});
json("kernel.json", {
  url: "http://kernel:6806",
  internal: true,
  tokenFile: "kernel-token",
  dataDir: "operations",
});
json("service.json", {
  kernelConfig: "kernel.json",
  agentTokenFile: "agent-token",
  accessCodeFile: "access-code",
  publicUrl: "http://127.0.0.1:6806",
  host: "0.0.0.0",
  port: 3000,
});
json("client.json", { url: "http://127.0.0.1:6806", tokenFile: "agent-token" });
write("compose.env", `CONCEPT_PRIVATE_ROOT=${root}\nCONCEPT_PORT=6806\nCONCEPT_UID=${process.getuid?.() ?? 1000}\nCONCEPT_GID=${process.getgid?.() ?? 1000}\nKERNEL_ACCESS_CODE=${kernelAccess}\n`);
console.log(`Created private configuration at ${root}; browser access code is in access-code; Agent configuration is client.json`);
