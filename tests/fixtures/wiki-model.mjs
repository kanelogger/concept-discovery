import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Synthetic integration fixture, never a production model or quality benchmark.
export const wikiFixtureKey = "wiki-fixture-key";
export function wikiFixtureReply(body, control = {}) {
  const user = body?.messages?.findLast(message => message.role === "user");
  const data = JSON.parse(user?.content ?? "{}");
  if (!data.source || typeof data.source.id !== "string" || typeof data.source.markdown !== "string" ||
      !(data.target === null || (data.target && typeof data.target.id === "string")))
    throw new Error("Fixture only accepts a source and one optional target");
  return control.draft ?? {
    title: data.target?.title ?? data.source.title + " · 知识卡",
    body: "## 核心理解\n\n" + data.source.markdown.trim(),
    question: "这份资料说明了什么？",
    quotes: [{ quote: data.source.markdown.slice(0, 240) }],
  };
}

export function createWikiFixtureServer({ controlFile, recordFile } = {}) {
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    const send = (status, body) => { response.writeHead(status); response.end(JSON.stringify(body)); };
    if (request.method === "GET" && request.url === "/health") return send(200, { fixture: "wiki-model", synthetic: true });
    if (request.method !== "POST" || !["/chat/completions", "/v1/chat/completions"].includes(request.url))
      return send(404, { error: { message: "Fixture endpoint missing" } });
    if (request.headers.authorization !== "Bearer " + wikiFixtureKey)
      return send(401, { error: { code: "fixture_auth", message: "Synthetic fixture credential required" } });
    try {
      const chunks = []; let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) throw new Error("Fixture request too large");
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const control = controlFile ? JSON.parse(readFileSync(controlFile, "utf8")) : {};
      const result = wikiFixtureReply(body, control);
      if (recordFile) {
        let prior = { count: 0, requests: [] };
        try { prior = JSON.parse(readFileSync(recordFile, "utf8")); } catch {}
        prior.count++;
        prior.requests.push({ model: body.model, input: JSON.parse(body.messages.findLast(message => message.role === "user").content), response: result });
        writeFileSync(recordFile, JSON.stringify(prior, null, 2) + "\n", { mode: 0o600 });
      }
      send(200, { id: "wiki-fixture-" + Date.now(), model: "wiki-fixture", choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(result) } }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
    } catch (error) {
      send(400, { error: { code: "fixture_input", message: error.message } });
    }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [controlFile, recordFile, readyFile, port = "31373"] = process.argv.slice(2);
  const server = createWikiFixtureServer({ controlFile, recordFile });
  server.listen(Number(port), "127.0.0.1", () => {
    if (readyFile) writeFileSync(readyFile, JSON.stringify({ port: server.address().port, synthetic: true }), { mode: 0o600 });
  });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close(() => process.exit(0)));
}
