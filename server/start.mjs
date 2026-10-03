import { createServer as createViteServer } from "vite";
import { createApiServer } from "./http.mjs";
import { PiModelRuntime } from "./pi-model-runtime.mjs";

const modelRuntime = new PiModelRuntime();
await modelRuntime.initialize();
const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
const app = createApiServer({ modelRuntime, fallback: (request, response) => vite.middlewares(request, response) });
const port = Number(process.env.PORT || 4173);
await app.initialize();
app.server.listen(port, "127.0.0.1", () => console.log(`Concept Discovery http://127.0.0.1:${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { await app.close(); await vite.close(); process.exit(0); });
