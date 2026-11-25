import assert from "node:assert/strict";
import test from "node:test";
import { agentToken, authHTTPSFixture, card, fragment, owner } from "./auth-https-fixture.mjs";
import { createApp } from "../../server/app.mjs";
import { openCardLifecycleTasks } from "../../scripts/card-lifecycle-tasks.mjs";

const navigation = {
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "cross-site",
};
const command = "/api/v1/commands/list";
const auth = { Authorization: "Bearer " + agentToken };
const sessionCookie = response => response.headers["set-cookie"].find(value => value.startsWith("__Host-cd-session="));

test("production fails closed if the authentication mode and store do not match the canonical source", () => {
  const options = { api: {}, agentToken, publicUrl: "https://test.invalid" };
  assert.throws(() => createApp(options));
  assert.throws(() => createApp({ ...options, authMode: "local" }));
  assert.throws(() => createApp({ ...options, authMode: "required" }));
});

test("lifecycle confirmation requires an owner session, canonical Origin, live preview and purge password", async t => {
  let time = Date.now();
  const tasks = openCardLifecycleTasks(":memory:", { now:() => time });
  t.after(() => tasks.close());
  const syncSummary={enabled:true,nextBatchAt:1795564800000,pendingCount:1,
    issues:[{rawId:"synthetic-card",code:"git_content_conflict"}]};
  const app = await authHTTPSFixture({ lifecycle:{ ...tasks,
    syncStatus:() => syncSummary,
    preview:(ownerId, plan) => tasks.preview(ownerId, { ...plan, library:"synthetic-library" }) } });
  t.after(() => app.close());
  const post = (path, data, headers = {}) => app.request(path, { method:"POST", data, headers:{ Origin:app.url, ...headers } });
  const login = await post("/api/session/login", owner);
  const Cookie = sessionCookie(login).split(";")[0];
  const url = "/api/card-lifecycle";
  assert.equal((await app.request(`${url}/sync-status`)).status,401);
  assert.equal((await app.request(`${url}/sync-status`,{headers:auth})).status,401);
  assert.deepEqual((await app.request(`${url}/sync-status`,{headers:{Cookie}})).json().data,syncSummary);
  const preview = async () => (await post(`${url}/preview`, { action:"purge", id:"synthetic-card" }, { Cookie })).json().data;
  const expired = await preview();
  time += 5 * 60_000;
  const current = await preview();
  const input = { id:current.id, password:owner.password };
  for (const [body, headers, expected] of [
    [input, {}, 401], [input, { ...auth, Cookie }, 401], [input, { Cookie, Origin:"https://untrusted.invalid" }, 403],
    [{...input, id:expired.id}, { Cookie }, 400], [{...input, password:"wrong"}, { Cookie }, 401],
  ]) {
    assert.equal((await post(`${url}/confirm`, body, headers)).status, expected);
    assert.equal(tasks.next(), null);
    assert.deepEqual(app.calls, []);
  }
  const responses = await Promise.all([post(`${url}/confirm`, input, { Cookie }), post(`${url}/confirm`, input, { Cookie })]);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  assert.deepEqual(responses[0].json().data, responses[1].json().data);
  assert.equal(tasks.next().id, current.id);
  tasks.update(current.id, "complete", { step:"synthetic-readback" });
  assert.equal(tasks.next(), null);
  assert.deepEqual(app.calls, []);
});

test("a recovery gate closes direct cards, archives and sharing before session or kernel reads", async t => {
  let ready = true;
  const app = await authHTTPSFixture({requireLifecycleReadiness:true,lifecycle:{ready:()=>({ready})}});
  t.after(()=>app.close());
  const login = await app.request("/api/session/login",{method:"POST",data:owner,headers:{Origin:app.url}});
  const Cookie = sessionCookie(login).split(";")[0];
  ready = false;
  for (const path of ["/api/readiness", "/cards", "/cards/"+card.id, "/archives", "/share", "/api/card-lifecycle/archives"]) {
    const response = await app.request(path,{headers:{Cookie}});
    assert.equal(response.status,503,path);
    assert.equal(response.json().error.code,"lifecycle_unavailable",path);
  }
  assert.deepEqual(app.calls,[]);
  assert.equal((await app.request("/api/status")).status,200);
  ready = true;
  assert.equal((await app.request("/api/readiness")).status,200);
  assert.equal((await app.request("/archives",{headers:{Cookie}})).status,200);
});

test("required HTTPS authentication gates private routes and leaves Agent authorization read-only", async t => {
  const app = await authHTTPSFixture();
  t.after(() => app.close());
  const get = (path, headers) => app.request(path, { headers });
  const post = (path, data, headers = {}) => app.request(path, { method: "POST", data, headers: { Origin: app.url, ...headers } });
  assert.equal((await get("/api/readiness")).status,503);
  const oldLink = "/?id=" + card.id + "&tag=learning";
  const loginPath = "/api/session/login";
  const logoutPath = "/api/session/logout";

  const redirect = await get(oldLink, navigation);
  assert.equal(redirect.status, 302);
  const login = new URL(redirect.headers.location, app.url);
  assert.equal(login.pathname, "/login");
  assert.equal(login.searchParams.get("next"), oldLink);
  assert.equal((await get(login.pathname, navigation)).status, 200);
  assert.deepEqual((await get("/api/status")).json(), { ok: true, data: { readOnly: true } });
  for (const path of ["/cards", "/wiki", "/scenarios", "/graph"]) {
    assert.equal((await get(path, navigation)).status, 302, path);
    assert.equal((await get(path)).status, 401, path);
  }
  for (const path of ["/api/session", "/api/scenarios", "/api/graph", "/assets/image.png"]) {
    const response = await get(path, auth);
    assert.equal(response.status, 401, path + " has no Bearer grant");
    assert.equal(response.json().error.code, "unauthorized");
    assert.equal(response.headers["cache-control"], "no-store");
  }
  assert.equal((await post(command, {})).status, 401);
  assert.equal((await post(loginPath, owner, { Origin: "https://other.invalid" })).status, 403);
  assert.equal((await app.request(loginPath, { method: "POST", data: owner })).status, 403);
  const incorrect = await post(loginPath, { ...owner, password: "wrong" });
  assert.equal(incorrect.status, 401);
  assert.equal(incorrect.json().error.code, "invalid_credentials");
  assert.equal(incorrect.headers["set-cookie"], undefined);
  assert.equal(app.assetReads(), 0);
  assert.deepEqual(app.calls, []);

  const signedIn = await post(loginPath, { ...owner, target: oldLink });
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.json().data.target, oldLink);
  assert.equal(signedIn.headers["set-cookie"].length, 1);
  const sessionAttributes = sessionCookie(signedIn);
  const cookie = sessionAttributes.split(";", 1)[0];
  for (const attribute of ["Path=/", "Secure", "HttpOnly", "SameSite=Lax"]) assert.ok(sessionAttributes.includes(attribute), attribute);
  assert.doesNotMatch(sessionAttributes, /\bDomain=/i);
  const session = (await get("/api/session", { Cookie: cookie })).json().data;
  assert.deepEqual(session, {
    expiresAt: signedIn.json().data.expiresAt,
    publicId: signedIn.json().data.publicId,
  });
  assert.notEqual(session.publicId, cookie.split("=")[1]);
  assert.equal((await get("/api/session", { Cookie: "__Host-cd-session=" + session.publicId })).status, 401);
  assert.equal((await get(oldLink, { Cookie: cookie })).status, 200);
  const attachment = await get("/assets/image.png", { Cookie: cookie });
  assert.equal(attachment.status, 200);
  assert.equal(attachment.text, "合成附件");
  assert.equal(app.assetReads(), 1);
  assert.equal((await app.request(command, { method: "POST", data: {}, headers: { Cookie: cookie } })).status, 403);
  assert.equal((await post(command, {}, { Cookie: cookie, Authorization: "Bearer invalid" })).status, 401);
  assert.equal((await post(command, {}, { Cookie: cookie })).status, 200);
  assert.deepEqual((await app.cli("list")).data.items, [card]);
  assert.equal((await app.request("/api/v1/commands/init", { method: "POST", data: {}, headers: auth })).status, 404);

  await app.restart();
  assert.deepEqual((await get("/api/session", { Cookie: cookie })).json().data, session);
  const staleLogout = await post(logoutPath, { publicId: "outdated-tab-session" }, { Cookie: cookie });
  assert.equal(staleLogout.status, 204);
  assert.equal(staleLogout.headers["set-cookie"], undefined);
  assert.deepEqual((await get("/api/session", { Cookie: cookie })).json().data, session);
  assert.equal((await post(logoutPath, {}, { Cookie: cookie, Origin: "https://other.invalid" })).status, 403);
  const logout = await post(logoutPath, {}, { Cookie: cookie });
  assert.equal(logout.status, 204);
  assert.equal(logout.headers["set-cookie"], undefined, "a delayed logout cannot clear a newer login cookie");
  assert.equal((await post(logoutPath, {}, { Cookie: cookie })).status, 204);
  assert.equal((await get("/assets/image.png", { Cookie: cookie })).status, 401);
  assert.equal((await get(oldLink, { ...navigation, Cookie: cookie })).status, 302);
  assert.equal(app.assetReads(), 1);
});

test("login normalizes unsafe return targets and rejects expired sessions", async t => {
  const app = await authHTTPSFixture();
  t.after(() => app.close());
  const login = target => app.request("/api/session/login", { method: "POST", data: { ...owner, target }, headers: { Origin: app.url } });
  const unsafe = ["https://other.invalid/cards", "//other.invalid/cards", "/\\other.invalid/cards", "/assets/private", "/cards\n", "/cards/%0a"];
  let latestSession;
  for (const target of unsafe) {
    const signedIn = await login(target);
    assert.equal(signedIn.status, 200, JSON.stringify(target));
    assert.equal(signedIn.json().data.target, "/cards");
    latestSession = sessionCookie(signedIn).split(";", 1)[0];
  }
  app.advance(24 * 60 * 60_000 + 1_000);
  assert.equal((await app.request("/api/session", { headers: { Cookie: latestSession } })).status, 401);
});

test("a private owner can share and revoke one frozen card over HTTPS", async t => {
  const app = await authHTTPSFixture();
  t.after(() => app.close());
  const headers = { Origin: app.url };
  const manage = "/api/card-shares/" + card.id;
  const readPath = "/api/card-share/read";
  const read = (token, overrides = {}) => app.request(readPath, { method: "POST", data: { token }, headers: { ...headers, ...overrides } });
  assert.equal((await app.request("/share", { headers: navigation })).status, 200);
  assert.equal((await app.request("/share")).headers["x-robots-tag"], "noindex, nofollow");
  assert.equal((await read("A".repeat(43))).status, 404);
  assert.equal((await app.request(manage, { headers: auth })).status, 401);
  assert.equal((await app.request(manage, { method: "PUT", headers: { ...headers, ...auth } })).status, 401);

  const signedIn = await app.request("/api/session/login", { method: "POST", headers, data: owner });
  const ownerHeaders = { ...headers, Cookie: sessionCookie(signedIn).split(";", 1)[0] };
  const manageRequest = (method, data) => app.request(manage, { method, data, headers: ownerHeaders });
  assert.equal((await app.request(manage, { method: "PUT", headers: { ...ownerHeaders, Origin: "https://other.invalid" } })).status, 403);
  assert.equal((await app.request("/api/card-shares/" + fragment, { method: "PUT", headers: ownerHeaders })).status, 404);
  assert.equal((await manageRequest("GET")).json().data.url, null);
  app.shareFixture.markdown = "\n\n![配图](assets/share.png) ![私有文档](assets/report.pdf) ![超限图片](assets/share-large.png) " +
    "![远程图片](https://other.invalid/tracker.png) [其他卡片](/cards/20261123080002-authabc) [公开来源](https://example.org/a)";
  const created = await manageRequest("PUT");
  assert.equal(created.status, 200);
  const url = new URL(created.json().data.url);
  const token = url.hash.slice(1);
  assert.match(url.pathname, /^\/share\/[a-f0-9]{32}$/);
  assert.equal(url.search, "");
  assert.match(token, /^[\w-]{43}$/);
  assert.equal((await manageRequest("PUT")).json().data.url, url.href);
  assert.equal((await manageRequest("GET")).json().data.url, url.href);

  const shared = await read(token);
  assert.equal(shared.status, 200);
  assert.equal(shared.headers["cache-control"], "no-store");
  assert.equal(shared.headers["set-cookie"], undefined);
  assert.equal((await read(token, { Origin: "https://other.invalid" })).status, 403);
  assert.equal((await read(token, { "Sec-Fetch-Site": "cross-site" })).status, 403);
  const data = shared.json().data;
  assert.equal(data.preview.title, card.title);
  assert.equal(data.wechat, false);
  assert.equal(data.title, card.title);
  assert.ok(data.html.includes(card.body));
  assert.match(data.html, /src="data:image\/png;base64,/);
  assert.equal(data.html.match(/<img /g).length, 1);
  assert.match(data.html, /超限图片/);
  assert.match(data.html, /其他卡片/);
  assert.match(data.html, /href="https:\/\/example.org\/a"/);
  assert.doesNotMatch(data.html, /\/cards\/|\/assets\/|tracker\.png/);
  assert.equal((await app.request("/cards/" + card.id, { headers: navigation })).status, 302);
  assert.equal((await app.request("/cards/20261123080002-authabc", { headers: navigation })).status, 302);
  assert.equal((await app.request("/assets/share.png")).status, 401);
  assert.equal((await app.request("/api/v1/commands/get-document", { method: "POST", headers, data: { id: card.id, token } })).status, 401);
  app.shareFixture.markdown = "\n\n后续私有改动";
  await app.restart();
  assert.deepEqual((await read(token)).json().data, data);
  app.shareFixture.active = false;
  assert.equal((await read(token)).status, 404);
  assert.equal((await manageRequest("DELETE", { token })).status, 200);
  app.shareFixture.active = true;
  await app.restart();
  assert.equal((await read(token)).status, 404);
  const replacement = new URL((await manageRequest("PUT")).json().data.url);
  assert.notEqual(replacement.hash, url.hash);
  assert.equal((await manageRequest("DELETE", { token })).status, 409);
  assert.match((await read(replacement.hash.slice(1))).json().data.html, /后续私有改动/);
});

test("a delayed duplicate creation cannot republish after the owner revokes the share", async t => {
  const app = await authHTTPSFixture();
  t.after(() => app.close());
  const signedIn = await app.request("/api/session/login", { method: "POST", headers: { Origin: app.url }, data: owner });
  const headers = { Origin: app.url, Cookie: sessionCookie(signedIn).split(";", 1)[0] };
  const manage = "/api/card-shares/" + card.id;
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  app.beforeRead.current = async () => {
    app.beforeRead.current = null;
    entered.resolve();
    await release.promise;
  };
  const delayed = app.request(manage, { method: "PUT", headers });
  try {
    await entered.promise;
    const first = await app.request(manage, { method: "PUT", headers });
    const token = new URL(first.json().data.url).hash.slice(1);
    assert.equal((await app.request(manage, { method: "DELETE", headers, data: { token } })).status, 200);
  } finally {
    release.resolve();
  }
  assert.equal((await delayed).status, 409);
  assert.equal((await app.request(manage, { headers })).json().data.url, null);
});

test("a legacy share gains a public preview without exposing its body or replacing its credential", async t => {
  const calls = [];
  let material = {
    title: '微信 "标题" <script>', description: "可以公开的摘要", cover: new URL("../../web/share-cover.png", import.meta.url),
  };
  let holdSignature;
  const fixture = await authHTTPSFixture({ getShareMaterial: () => material, wechatShare: {
    sign: async url => {
      calls.push(url);
      if (holdSignature) {
        holdSignature.entered.resolve();
        await holdSignature.release.promise;
      }
      return { appId: "wx0123456789abcdef", signature: "fixture-signature" };
    },
    sdk: async () => Buffer.from("window.wx = {};"),
  } });
  t.after(() => fixture.close());
  const token = fixture.legacyShare();
  const endpoint = "/api/card-shares/" + card.id;
  const publicRead = (path, data) => fixture.request(path, {
    method: "POST", headers: { Origin: fixture.url }, data,
  });
  const legacyRead = await publicRead("/api/card-share/read", { token });
  assert.equal(legacyRead.json().data.preview, undefined);
  const signedIn = await publicRead("/api/session/login", owner);
  const ownerHeaders = { Origin: fixture.url, Cookie: sessionCookie(signedIn).split(";", 1)[0] };
  const save = data => fixture.request(endpoint, { method: "PATCH", headers: ownerHeaders, data });
  const suggestion = (await fixture.request(endpoint, { headers: ownerHeaders })).json().data.suggestion;
  assert.equal(suggestion.title, material.title);
  assert.equal((await fixture.request(suggestion.image)).status, 401);
  assert.equal((await fixture.request(suggestion.image, { headers: ownerHeaders })).headers["content-type"], "image/png");
  const fields = { token, version: 0 };
  const updated = await save({ ...fields, title: "客户端篡改的字段", cover: "data:image/svg+xml;base64,PHN2Zz4=" });
  assert.equal(updated.status, 200);
  const { url, preview } = updated.json().data;
  const page = new URL(url);
  assert.equal(page.hash, "#" + token);
  assert.match(page.pathname, /^\/share\/[a-f0-9]{32}$/);
  const shell = await fixture.request(page.pathname, { headers: navigation });
  assert.equal(shell.status, 200);
  assert.match(shell.text, /property="og:title" content="微信 &quot;标题&quot; &lt;script&gt;"/);
  assert.match(shell.text, /property="og:description" content="可以公开的摘要"/);
  assert.equal(shell.text.includes(card.body) || shell.text.includes(token), false);
  assert.match(shell.headers["content-security-policy"], /script-src 'self'/);
  const cover = new URL(preview.image);
  const head = await fixture.request(cover.pathname + cover.search, {
    method: "HEAD", headers: { "Sec-Fetch-Site": "cross-site" },
  });
  assert.equal(head.status, 200);
  assert.equal(head.headers["content-type"], "image/png");
  assert.equal((await publicRead("/api/card-share/read", { previewId: preview.id })).status, 404);
  assert.equal((await publicRead("/api/card-share/read", { token, previewId: "0".repeat(32) })).status, 404);
  assert.match((await publicRead("/api/card-share/read", { token })).json().data.html, /这个正文/);
  const signPath = "/api/card-share/wechat-config";
  assert.equal((await publicRead(signPath, { token, previewId: preview.id, url })).status, 400);
  assert.equal((await publicRead(signPath, { token, previewId: preview.id, url: fixture.url + "/cards" })).status, 400);
  const signingUrl = fixture.url + page.pathname + "?entry=friend%2Fshare&from=timeline";
  const signed = await publicRead(signPath, { token, previewId: preview.id, url: signingUrl });
  assert.deepEqual(calls, [signingUrl]);
  assert.equal(signed.json().data.url, url);
  assert.equal(signed.json().data.preview.image, preview.image);
  assert.equal((await save({ ...fields, version: 0 })).status, 409);
  material = { ...material, title: "重新生成的预览" };
  const edited = (await save({ ...fields, version: preview.version })).json().data;
  assert.equal(edited.preview.title, material.title);
  assert.equal(edited.url, url);
  assert.notEqual(edited.preview.image, preview.image);
  fixture.shareFixture.active = false;
  assert.equal((await fixture.request(page.pathname)).status, 404);
  assert.equal((await fixture.request(cover.pathname)).status, 404);
  assert.equal((await publicRead(signPath, { token, previewId: preview.id, url: signingUrl })).status, 404);
  fixture.shareFixture.active = true;
  holdSignature = { entered: Promise.withResolvers(), release: Promise.withResolvers() };
  const delayed = publicRead(signPath, { token, previewId: preview.id, url: signingUrl });
  try {
    await holdSignature.entered.promise;
    assert.equal((await fixture.request(endpoint, { method: "DELETE", headers: ownerHeaders, data: { token } })).status, 200);
  } finally {
    holdSignature.release.resolve();
  }
  assert.equal((await delayed).status, 404);
  assert.equal((await fixture.request(page.pathname)).status, 404);
  assert.equal((await fixture.request(cover.pathname)).status, 404);
  assert.equal((await publicRead(signPath, { token, previewId: preview.id, url: signingUrl })).status, 404);
  assert.deepEqual(calls, [signingUrl, signingUrl]);
});
