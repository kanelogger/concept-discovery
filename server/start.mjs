import { createServer as createViteServer } from "vite";
import { createApiServer } from "./http.mjs";

const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
const app = createApiServer({ fallback: (request, response) => vite.middlewares(request, response) });
const port = Number(process.env.PORT || 4173);
app.server.listen(port, "127.0.0.1", () => console.log(`Concept Discovery http://127.0.0.1:${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { await app.close(); await vite.close(); process.exit(0); });
