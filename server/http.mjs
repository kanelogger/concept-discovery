import { createServer } from "node:http";
import { openRegistry, RegistryError } from "./registry.mjs";
import { configuredModelAdapter } from "./model-config.mjs";
import { parseRecommendationRequest, RecommendationError, runRecommendation } from "./recommendation-contract.mjs";

const json = (response, status, body, extraHeaders = {}) => {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders });
  response.end(JSON.stringify(body));
};

async function body(request, maxBytes = 32 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new RegistryError(413, "too_large", "Request too large");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new RegistryError(400, "invalid_json", "Invalid JSON body"); }
}

export function createApiServer({ dbPath, fallback, modelAdapterFactory = configuredModelAdapter } = {}) {
  const registry = openRegistry(dbPath);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (!url.pathname.startsWith("/api/")) {
      if (fallback) return fallback(request, response);
      return json(response, 404, { error: "not_found", message: "Not found" });
    }
    try {
      const path = url.pathname.split("/").filter(Boolean);
      if (path.length === 3 && path[1] === "assets" && request.method === "GET") {
        const asset = registry.asset(path[2]);
        response.writeHead(200, { "Content-Type": asset.mime_type, "Content-Length": asset.data.length, "Cache-Control": "public, max-age=31536000, immutable" });
        return response.end(asset.data);
      }
      if (path.length === 2 && path[1] === "dashboard" && request.method === "GET") return json(response, 200, registry.dashboard());
      if (path.length === 2 && path[1] === "recommendations" && request.method === "POST") {
        const input = parseRecommendationRequest(await body(request, 64 * 1024));
        const concepts = registry.query({ locale: input.locale, view: "browse", status: "recommendable" });
        const adapter = modelAdapterFactory();
        const result = await runRecommendation(input, concepts, adapter);
        return json(response, 200, result, { "X-Model-Provider": adapter.metadata?.provider || "unspecified", "X-Model-Name": adapter.metadata?.model || "unspecified" });
      }
      if (path.length === 2 && path[1] === "concepts") {
        if (request.method === "GET") {
          const concepts = registry.query(Object.fromEntries(url.searchParams));
          return json(response, 200, { count: concepts.length, concepts });
        }
        if (request.method === "POST") return json(response, 201, registry.create(await body(request)));
      }
      if (path.length === 3 && path[1] === "concepts" && path[2] === "preview" && request.method === "POST") return json(response, 200, { readiness: registry.previewCreate(await body(request)) });
      if (path.length >= 3 && path[1] === "concepts") {
        const id = decodeURIComponent(path[2]);
        if (path.length === 3 && request.method === "GET") return json(response, 200, registry.get(id));
        if (path.length === 3 && request.method === "PATCH") return json(response, 200, registry.update(id, await body(request)));
        if (path.length === 3 && request.method === "DELETE") return json(response, 200, registry.delete(id, await body(request)));
        if (path.length === 4 && path[3] === "preview" && request.method === "POST") return json(response, 200, registry.previewUpdate(id, await body(request)));
        if (path.length === 4 && path[3] === "revisions" && request.method === "GET") return json(response, 200, { revisions: registry.revisions(id) });
        if (path.length === 4 && path[3] === "archive" && request.method === "POST") return json(response, 200, registry.archive(id, await body(request)));
        if (path.length === 4 && path[3] === "restore" && request.method === "POST") return json(response, 200, registry.restore(id, await body(request)));
      }
      json(response, 404, { error: "not_found", message: "Not found" });
    } catch (error) {
      if (error instanceof RegistryError || error instanceof RecommendationError) json(response, error.status, { error: error.code, message: error.message });
      else { console.error(error); json(response, 500, { error: "internal_error", message: "Internal error" }); }
    }
  });
  return { server, registry, close: async () => { await new Promise((resolve) => server.close(resolve)); registry.close(); } };
}
