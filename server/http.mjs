import { createServer } from "node:http";
import { openRegistry, RegistryError } from "./registry.mjs";
import { PiModelRuntime } from "./pi-model-runtime.mjs";
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

function requireLocalHost(request) {
  const host = request.headers.host || "";
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) throw new RegistryError(403, "local_origin_required", "Model settings are available only from the local application");
}

function requireMatchingOrigin(request, { required = true } = {}) {
  requireLocalHost(request);
  const host = request.headers.host || "";
  const origin = request.headers.origin;
  if (!origin && required) throw new RegistryError(403, "local_origin_required", "Open model settings from the local application");
  if (!origin) return;
  let parsed;
  try { parsed = new URL(origin); } catch { throw new RegistryError(403, "local_origin_required", "Invalid request origin"); }
  if (`${parsed.host}` !== host || !["http:", "https:"].includes(parsed.protocol)) throw new RegistryError(403, "local_origin_required", "Model settings are available only from the local application");
}

export function createApiServer({ dbPath, fallback, modelAdapterFactory, modelRuntime = new PiModelRuntime() } = {}) {
  const registry = openRegistry(dbPath);
  const getModelAdapter = modelAdapterFactory ?? (() => modelRuntime.adapter());
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (!url.pathname.startsWith("/api/")) {
      if (fallback) return fallback(request, response);
      return json(response, 404, { error: "not_found", message: "Not found" });
    }
    try {
      const path = url.pathname.split("/").filter(Boolean);
      if (path[1] === "model-settings") requireMatchingOrigin(request, { required: false });
      if (path.length === 2 && path[1] === "model-settings" && request.method === "GET") return json(response, 200, await modelRuntime.status());
      if (path.length === 3 && path[1] === "model-settings" && path[2] === "deepseek" && request.method === "POST") {
        requireMatchingOrigin(request);
        const input = await body(request, 8192);
        await modelRuntime.setDeepSeekKey(input.apiKey);
        return json(response, 200, { ok: true });
      }
      if (path.length === 3 && path[1] === "model-settings" && path[2] === "oauth" && request.method === "POST") {
        requireMatchingOrigin(request);
        const input = await body(request, 1024);
        return json(response, 202, await modelRuntime.startOAuth(input.provider));
      }
      if (path.length === 4 && path[1] === "model-settings" && path[2] === "oauth" && request.method === "GET") {
        return json(response, 200, modelRuntime.getOAuthSession(path[3], Number(url.searchParams.get("after") || 0)));
      }
      if (path.length === 5 && path[1] === "model-settings" && path[2] === "oauth" && path[4] === "reply" && request.method === "POST") {
        requireMatchingOrigin(request);
        const input = await body(request, 8192);
        modelRuntime.replyOAuthPrompt(path[3], input.promptId, input.value);
        return json(response, 200, { ok: true });
      }
      if (path.length === 4 && path[1] === "model-settings" && path[2] === "oauth" && request.method === "DELETE") {
        requireMatchingOrigin(request);
        modelRuntime.cancelOAuth(path[3]);
        return json(response, 200, { ok: true });
      }
      if (path.length === 3 && path[1] === "model-settings" && path[2] === "selection" && request.method === "PUT") {
        requireMatchingOrigin(request);
        const input = await body(request, 2048);
        await modelRuntime.selectModel(input.provider, input.model);
        return json(response, 200, { ok: true });
      }
      if (path.length === 3 && path[1] === "model-settings" && path[2] === "test" && request.method === "POST") {
        requireMatchingOrigin(request);
        return json(response, 200, await modelRuntime.testConnection());
      }
      if (path.length === 4 && path[1] === "model-settings" && path[2] === "credentials" && request.method === "DELETE") {
        requireMatchingOrigin(request);
        await modelRuntime.disconnect(path[3]);
        return json(response, 200, { ok: true });
      }
      if (path.length === 3 && path[1] === "assets" && request.method === "GET") {
        const asset = registry.asset(path[2]);
        response.writeHead(200, { "Content-Type": asset.mime_type, "Content-Length": asset.data.length, "Cache-Control": "public, max-age=31536000, immutable" });
        return response.end(asset.data);
      }
      if (path.length === 2 && path[1] === "dashboard" && request.method === "GET") return json(response, 200, registry.dashboard());
      if (path.length === 2 && path[1] === "discover" && request.method === "POST") {
        requireMatchingOrigin(request, { required: false });
        const input = parseRecommendationRequest(await body(request, 64 * 1024));
        const concepts = registry.query({ locale: input.locale, view: "browse", status: "browsable" });
        if (!concepts.length) return json(response, 200, { locale: input.locale, diagnosis: [], recommendations: [] });
        const adapter = await getModelAdapter();
        const relations = registry.relationsForCandidates(concepts.map((concept) => concept.id));
        const result = await runRecommendation(input, concepts, adapter, { relations, eligibility: "browsable" });
        return json(response, 200, result, { "X-Model-Provider": adapter.metadata?.provider || "unspecified", "X-Model-Name": adapter.metadata?.model || "unspecified" });
      }
      if (path.length === 2 && path[1] === "recommendations" && request.method === "POST") {
        requireMatchingOrigin(request, { required: false });
        const input = parseRecommendationRequest(await body(request, 64 * 1024));
        const concepts = registry.query({ locale: input.locale, view: "browse", status: "recommendable" });
        const adapter = await getModelAdapter();
        const relations = registry.relationsForCandidates(concepts.map((concept) => concept.id));
        const result = await runRecommendation(input, concepts, adapter, { relations });
        return json(response, 200, result, { "X-Model-Provider": adapter.metadata?.provider || "unspecified", "X-Model-Name": adapter.metadata?.model || "unspecified" });
      }
      if (path.length === 2 && path[1] === "relations" && request.method === "POST") return json(response, 201, registry.createRelation(await body(request)));
      if (path.length === 3 && path[1] === "relations") {
        const id = Number(path[2]);
        if (request.method === "GET") return json(response, 200, registry.getRelation(id));
        if (request.method === "PATCH") return json(response, 200, registry.updateRelation(id, await body(request)));
        if (request.method === "DELETE") return json(response, 200, registry.deleteRelation(id, await body(request)));
      }
      if (path.length === 2 && path[1] === "concepts") {
        if (request.method === "GET") {
          let concepts = registry.query(Object.fromEntries(url.searchParams));
          const include = url.searchParams.get("include");
          if (include && include !== "relation_preview") throw new RegistryError(400, "invalid_input", "Unknown include");
          if (include === "relation_preview") concepts = registry.relationPreviews(concepts, url.searchParams.get("locale") || "cn");
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
        if (path.length === 4 && path[3] === "relations" && request.method === "GET") return json(response, 200, { relations: registry.listRelations(id, url.searchParams.get("locale")) });
        if (path.length === 4 && path[3] === "archive" && request.method === "POST") return json(response, 200, registry.archive(id, await body(request)));
        if (path.length === 4 && path[3] === "restore" && request.method === "POST") return json(response, 200, registry.restore(id, await body(request)));
      }
      json(response, 404, { error: "not_found", message: "Not found" });
    } catch (error) {
      if (error instanceof RegistryError || error instanceof RecommendationError) json(response, error.status, { error: error.code, message: error.message });
      else { console.error(error); json(response, 500, { error: "internal_error", message: "Internal error" }); }
    }
  });
  return { server, registry, modelRuntime, initialize: () => modelRuntime.initialize(), close: async () => { await new Promise((resolve) => server.close(resolve)); registry.close(); modelRuntime.close(); } };
}
