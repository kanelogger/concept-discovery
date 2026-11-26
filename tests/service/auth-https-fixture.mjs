import { execFile, execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { createServer as createTLS, request as requestTLS } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createApp } from "../../server/app.mjs";
import { initializeAuthStore, openAuthStore } from "../../server/auth-store.mjs";

const loopback = "127.0.0.1";
const exec = promisify(execFile);
const listen = server => new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, loopback, () => {
    server.removeListener("error", reject);
    resolve(server.address().port);
  });
});
const close = server => new Promise(resolve => {
  if (!server?.listening) return resolve();
  server.close(resolve);
  server.closeAllConnections();
});

export const owner = {
  username: "synthetic-owner",
  password: "A synthetic long fixture password!",
};
export const card = {
  id: "20261123080000-authabc",
  title: "私有登录验收卡",
  body: "这个正文只能在登录后读取。",
};
export const fragment = "20261123080001-authabc";
export const agentToken = "synthetic-agent-token";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF/0AAAAASUVORK5CYII=", "base64");

export async function authHTTPSFixture({ wechatShare, getShareMaterial, lifecycle, requireLifecycleReadiness, through, retained, rawId, listItems = [card] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "cd-auth-https-"));
  const keyFile = join(root, "tls.key");
  const certFile = join(root, "tls.crt");
  let proxy, kernel, application, authStore, middle;
  let target;
  let instant = Date.now();
  let applicationOptions;
  let assetReads = 0, programRequests = 0;
  const calls = [];
  const beforeRead = { current: null };
  const shareFixture = { active: true, markdown: "" };
  const now = () => instant;
  const storeOptions = { databasePath: join(root, "owner.sqlite"), now };
  async function useStore() {
    authStore = openAuthStore(storeOptions);
    application = createApp({ ...applicationOptions, authStore });
    const port = await listen(application);
    middle = through ? await through(port) : null;
    target = middle?.port ?? port;
  }
  async function cleanup() {
    await close(proxy);
    await middle?.close();
    await close(application);
    authStore?.close();
    await close(kernel);
    rmSync(root, { recursive: true, force: true });
  }
  try {
    execFileSync("openssl", ["req", "-x509", "-nodes", "-newkey", "rsa:2048", "-days", "1", "-sha256",
      "-subj", "/CN=concept-discovery-isolated", "-addext", "subjectAltName=IP:127.0.0.1",
      "-keyout", keyFile, "-out", certFile], { stdio: "ignore" });
    const cert = readFileSync(certFile);
    const spki = new X509Certificate(cert).publicKey.export({ type: 'spki', format: 'der' });
    const publicKeyPin = createHash('sha256').update(spki).digest('base64');
    proxy = createTLS({ cert, key: readFileSync(keyFile) }, (req, res) => {
      if (/^\/ui\/[^?]+\.(?:js|css)(?:\?|$)/.test(req.url)) programRequests++;
      const upstream = request({ host: loopback, port: target, method: req.method, path: req.url, headers: req.headers }, response => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      });
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      res.on("close", () => upstream.destroy());
      req.pipe(upstream);
    });
    const url = "https://" + loopback + ":" + await listen(proxy);
    kernel = createServer(async (req, res) => {
      assetReads++;
      let body = "";
      for await (const chunk of req) body += chunk;
      const { path } = JSON.parse(body);
      if (path === "/data/assets/share-large.png") {
        res.writeHead(200, { "Content-Type": "image/png", "Content-Length": 7 * 1024 * 1024 });
        res.end(png);
        return;
      }
      if (path === "/data/assets/share.png") {
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(png);
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("合成附件");
    });
    const kernelPort = await listen(kernel);
    await initializeAuthStore(storeOptions, owner);
    applicationOptions = {
      publicUrl: url,
      authMode: "required",
      agentToken,
      wechatShare,
      getShareMaterial,
      lifecycle,
      requireLifecycleReadiness,
      wikiRoot: join(root, "wiki"),
      api: {
        origin: "http://" + loopback + ":" + kernelPort,
        c: { token: "synthetic-kernel-token", notebookId: "synthetic-book", libraryRootId: "synthetic-library" },
        async sql(statement) {
          if (shareFixture.active && statement.includes(`b.id = '${card.id}'`)) return [{ id: card.id, title: card.title, rawId }];
          if (retained && statement.includes(`b.id = '${retained.id}'`)) return [retained];
          return [];
        },
      },
      async executeCommand(_api, command, input) {
        calls.push(command);
        await beforeRead.current?.(command, input);
        if (command === "get-document" && input.id === card.id) return {
          id: card.id,
          title: card.title,
          markdown: '<span id="' + fragment + '"></span>\n\n## 理解\n\n' + card.body + shareFixture.markdown,
          editable: false,
          deletable: true,
        };
        if (command === "get-document" && input.id === retained?.id)
          return {id:retained.id,title:retained.title,markdown:retained.body,editable:false};
        if (command === "list") return { items: listItems, total: listItems.length, tags: [] };
        throw new Error("Fixture received unexpected command");
      },
    };
    await useStore();
    const client = join(root, "client.json");
    writeFileSync(join(root, "agent-token"), agentToken, { mode: 0o600 });
    writeFileSync(client, JSON.stringify({ url, tokenFile: "agent-token" }), { mode: 0o600 });
    return {
      url, calls, now, beforeRead, shareFixture, publicKeyPin, programRequests: () => programRequests,
      assetReads: () => assetReads,
      advance(ms) { instant += ms; },
      revoke(token) { authStore.logout(token); },
      fixtureShareStore: () => authStore.shares,
      legacyShare() {
        return authStore.shares.create(card.id, authStore.shares.state(card.id).generation, { title: card.title, html: `<p>${card.body}</p>` });
      },
      async withShadow(start, check) {
        // Copy the quiescent synthetic auth DB, then exercise both versions behind the same TLS origin.
        await middle?.close();
        await close(application);
        authStore.close();
        let candidate;
        try {
          candidate = await start(storeOptions.databasePath);
          target = candidate.address().port;
          await check();
        } finally {
          await close(candidate);
          await useStore();
        }
      },
      async restart() {
        await middle?.close();
        await close(application);
        authStore.close();
        await useStore();
      },
      request(path, { method = "GET", headers = {}, data } = {}) {
        return new Promise((resolve, reject) => {
          const body = data === undefined ? undefined : JSON.stringify(data);
          const req = requestTLS(url + path, { ca: cert, method, headers: {
            ...(body === undefined ? {} : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }),
            ...headers,
          } }, res => {
            const chunks = [];
            res.on("data", chunk => chunks.push(chunk));
            res.on("error", reject);
            res.on("end", () => {
              const text = Buffer.concat(chunks).toString("utf8");
              resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) });
            });
          });
          req.on("error", reject);
          req.end(body);
        });
      },
      async cli(command) {
        const run = exec(process.execPath,
          [fileURLToPath(new URL("../../bin/concept-discovery.mjs", import.meta.url)), command],
          { env: { ...process.env, CONCEPT_DISCOVERY_CONFIG: client, NODE_EXTRA_CA_CERTS: certFile }, timeout: 30_000 });
        run.child.stdin.end("{}");
        const { stdout } = await run;
        return JSON.parse(stdout);
      },
      close: cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
