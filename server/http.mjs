import { createServer } from "node:http";
import { openRegistry, RegistryError } from "./registry.mjs";

const json = (response, status, body) => {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
};

async function body(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 1024 * 1024) throw new RegistryError(413, "too_large", "Request too large");
  }
  try { return JSON.parse(raw); } catch { throw new RegistryError(400, "invalid_json", "Invalid JSON body"); }
}

export function createApiServer({ dbPath, fallback } = {}) {
  const registry = openRegistry(dbPath);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (!url.pathname.startsWith("/api/")) {
      if (fallback) return fallback(request, response);
      return json(response, 404, { error: "not_found", message: "Not found" });
    }
    try {
      const path = url.pathname.split("/").filter(Boolean);
      if (path.length === 2 && path[1] === "concepts") {
        if (request.method === "GET") return json(response, 200, { concepts: registry.list() });
        if (request.method === "POST") return json(response, 201, registry.create(await body(request)));
      }
      if (path.length >= 3 && path[1] === "concepts") {
        const id = decodeURIComponent(path[2]);
        if (path.length === 3 && request.method === "GET") return json(response, 200, registry.get(id));
        if (path.length === 3 && request.method === "PATCH") return json(response, 200, registry.update(id, await body(request)));
        if (path.length === 4 && path[3] === "revisions" && request.method === "GET") return json(response, 200, { revisions: registry.revisions(id) });
      }
      json(response, 404, { error: "not_found", message: "Not found" });
    } catch (error) {
      if (error instanceof RegistryError) json(response, error.status, { error: error.code, message: error.message });
      else { console.error(error); json(response, 500, { error: "internal_error", message: "Internal error" }); }
    }
  });
  return { server, registry, close: async () => { await new Promise((resolve) => server.close(resolve)); registry.close(); } };
}
