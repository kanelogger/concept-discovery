import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../server/app.mjs";
import { createModelSettings } from "../../server/model-settings.mjs";

test("model settings require a browser session, save privately and take effect on the next ask", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cd-model-settings-"));
  const file = join(dir, "model-settings.json");
  const old = {
    url: "https://old.example/v1/chat/completions",
    model: "old-model", apiKey: "fixture-old-key", maxTokenField: "max_tokens",
  };
  const settings = createModelSettings(file, old);
  const origin = "http://127.0.0.1";
  const sends = [];
  const server = createApp({
    publicUrl: origin, agentToken: "agent-fixture", accessCode: "access-fixture",
    api: { c: {} }, modelSettings: settings, logAsk: () => {},
    executeCommand: async (_api, name, _input, { complete }) => {
      assert.equal(name, "ask");
      await complete({ prompt: "fixture", data: {}, maxTokens: 12 });
      return { cards: [] };
    },
    modelFetch: async (url, request) => {
      sends.push({ url, token: request.headers.Authorization, ...JSON.parse(request.body) });
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: "{}" } }] });
    },
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = origin + ":" + server.address().port;
  const token = { authorization: "Bearer agent-fixture" };
  const json = (path, method, headers, body) => fetch(url + path, {
    method, headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const path = "/api/model-settings";
  try {
    assert.equal((await json(path, "GET", {})).status, 401);
    assert.equal((await json(path, "GET", token)).status, 403);
    const login = await json("/api/session", "POST", { origin }, { accessCode: "access-fixture" });
    const browser = { cookie: login.headers.get("set-cookie").split(";")[0], origin };
    const first = await (await json(path, "GET", browser)).text();
    assert.doesNotMatch(first, /fixture-old-key|apiKey/);
    assert.equal(JSON.parse(first).data.model, "old-model");
    const fields = { baseUrl: "https://old.example/v1/", model: "new-model", maxTokenField: "max_tokens" };
    assert.equal((await json(path, "PUT", { ...browser, origin: "https://wrong.example" }, fields)).status, 403);
    assert.equal((await json(path, "PUT", token, fields)).status, 403);
    assert.equal((await json(path, "PUT", browser, { ...fields, baseUrl: "https://other.example/v1" })).status, 400);
    assert.equal((await json(path, "PUT", browser, { ...fields, baseUrl: "file:///tmp/test" })).status, 400);
    const saved = await (await json(path, "PUT", browser, fields)).text();
    assert.doesNotMatch(saved, /fixture-old-key|apiKey/);
    assert.equal(JSON.parse(saved).data.model, "new-model");
    assert.equal(sends.length, 0);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).apiKey, "fixture-old-key");
    assert.equal(createModelSettings(file, old).current().model, "new-model");
    assert.equal((await json("/api/v1/commands/ask", "POST", token, { question: "fixture" })).status, 200);
    assert.equal(sends[0].model, "new-model");
    assert.equal(sends[0].max_tokens, 12);
    assert.equal(sends[0].token, "Bearer fixture-old-key");
    const changed = await json(path, "PUT", browser, { ...fields, baseUrl: "https://other.example/v1", apiKey: "fixture-new-key" });
    assert.equal(changed.status, 200);
    assert.doesNotMatch(await changed.text(), /fixture-new-key|apiKey/);
    assert.equal(createModelSettings(file, old).current().apiKey, "fixture-new-key");
  } finally {
    await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
