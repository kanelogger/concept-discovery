import { useEffect, useRef, useState } from "react";
import { Button } from "./components/ui/button.jsx";
import { previewIdFrom } from "./share-path.mjs";
export { default as stylesheet } from "./card-share.css?route";

async function request(path, { method = "GET", signal, data, credentials = "same-origin" } = {}) {
  const response = await fetch(path, {
    method, signal, credentials,
    ...(data && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  });
  const result = await response.json().catch(error => {
    if (response.ok) throw error;
    return {};
  });
  if (!response.ok || !result.ok) throw Object.assign(new Error(result.error?.message), { status: response.status });
  return result.data;
}

async function requestWithDeadline(path, { signal, ...options }) {
  const deadline = new AbortController();
  const cancel = () => deadline.abort();
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, 8000);
  try {
    return await request(path, { ...options, signal: deadline.signal });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}

async function readSharedCard(token, previewId, signal) {
  const read = () => requestWithDeadline("/api/card-share/read", {
    method: "POST", data: { token, previewId }, credentials: "omit", signal,
  });
  try {
    return await read();
  } catch (error) {
    const transient = error instanceof TypeError || error instanceof SyntaxError ||
      error.name === "AbortError" || [502, 503, 504].includes(error.status);
    if (signal.aborted || !transient) throw error;
    return read();
  }
}

export function CardSharePanel({ cardId }) {
  const path = "/api/card-shares/" + encodeURIComponent(cardId);
  const [details, setDetails] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [attempt, setAttempt] = useState(0);
  const field = useRef(null);
  const copyButton = useRef(null);
  const createButton = useRef(null);
  const focusNext = useRef(false);
  const supportsCommand = "CommandEvent" in window;
  const { url, preview, suggestion } = details ?? {};
  const presentation = preview ?? suggestion;

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    request(path, { signal: controller.signal }).then(setDetails, () => {
      if (!controller.signal.aborted) setError("无法读取分享状态，请重试。");
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false);
    });
    return () => controller.abort();
  }, [path, attempt]);

  useEffect(() => {
    if (!focusNext.current || busy) return;
    focusNext.current = false;
    (url ? copyButton.current : createButton.current)?.focus();
  }, [url, busy]);

  async function copy(input) {
    setStatus("");
    try {
      await navigator.clipboard.writeText(input.value);
      setStatus("已复制链接");
    } catch {
      input.focus();
      input.select();
      setStatus("自动复制失败，请手动复制已选中的链接。");
    }
  }

  useEffect(() => {
    const input = field.current;
    if (!supportsCommand || !input) return;
    const onCommand = event => {
      if (event.command === "--copy-card-share") void copy(input);
    };
    input.addEventListener("command", onCommand);
    return () => input.removeEventListener("command", onCommand);
  }, [url, supportsCommand]);

  async function change(method) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const token = url && new URL(url).hash.slice(1);
      const data = await request(path, {
        method, ...(method === "DELETE" && { data: { token } }),
        ...(method === "PATCH" && { data: { token, version: preview?.version ?? 0 } }),
      });
      focusNext.current = true;
      setDetails(data);
      setStatus(method === "PATCH" ? "分享预览已更新" : data.url ? "分享链接已创建" : "分享链接已撤销");
    } catch (failure) {
      setError(failure.status && failure.message ? failure.message : "无法确认操作结果，请重新打开分享面板后再试。");
      if (failure.status === 409) setDetails(null);
    } finally {
      setBusy(false);
    }
  }

  return <section className="card-share-panel" id="card-share-panel" aria-label="分享这张卡" aria-busy={busy}>
    <p>持有链接的人可以免登录阅读这张卡的副本。</p>
    {presentation && <div className="card-share-sample">
      <p>微信好友转发预览</p>
      <div>
        <strong>{presentation.title}</strong>
        {presentation.description && <p>{presentation.description}</p>}
        <img src={presentation.image} alt="" width={56} height={56} />
      </div>
    </div>}
    {details && url && <>
      <label htmlFor="card-share-url">分享链接</label>
      <div className="card-share-actions">
        <input ref={field} id="card-share-url" type="text" value={url} readOnly spellCheck={false} />
        <Button ref={copyButton} disabled={busy} command="--copy-card-share" commandfor="card-share-url"
          onClick={supportsCommand ? undefined : () => void copy(field.current)}>复制链接</Button>
        <Button danger variant="text" disabled={busy} onClick={() => void change("DELETE")}>撤销链接</Button>
      </div>
      <p className="card-share-link-help">在微信打开链接后，用右上角菜单转发。</p>
    </>}
    {details && !url && <Button ref={createButton} variant="primary" disabled={busy} aria-busy={busy} onClick={() => void change("PUT")}>
      创建分享链接
    </Button>}
    {details && url && !preview && suggestion && <Button disabled={busy} aria-busy={busy} onClick={() => void change("PATCH")}>
      启用新版转发预览
    </Button>}
    {!details && !busy && <Button onClick={() => setAttempt(attempt + 1)}>重新读取分享状态</Button>}
    {busy && !details && <p role="status">正在读取分享状态…</p>}
    {error && <p className="card-share-error" role="alert">{error}</p>}
    <div role="status">{status}</div>
  </section>;
}

let sdkLoading;
function loadWechatSDK() {
  sdkLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      reject(new Error("微信接口不可用"));
    };
    const timer = setTimeout(fail, 8000);
    script.src = "/share/wechat-sdk.js";
    script.onload = () => {
      clearTimeout(timer);
      if (window.wx) resolve(window.wx);
      else fail();
    };
    script.onerror = fail;
    document.head.append(script);
  }).catch(error => {
    sdkLoading = undefined;
    throw error;
  });
  return sdkLoading;
}

async function setWechatShare(token, previewId, signal) {
  const config = await requestWithDeadline("/api/card-share/wechat-config", {
    method: "POST", data: { token, previewId, url: location.href.split("#")[0] },
    credentials: "omit", signal,
  });
  if (signal.aborted) return;
  const sdk = await loadWechatSDK();
  if (signal.aborted) return;
  const { signature, url, preview } = config;
  await new Promise((resolve, reject) => {
    let complete = false;
    const finish = error => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    const failed = () => finish(new Error("微信未能设置转发样式"));
    const abort = () => finish(signal.reason);
    const timer = setTimeout(failed, 8000);
    signal.addEventListener("abort", abort, { once: true });
    sdk.error(failed);
    sdk.ready(() => {
      if (signal.aborted || complete) return;
      const data = { title: preview.title, link: url, imgUrl: preview.image };
      let remaining = 2;
      const success = () => { if (--remaining === 0) finish(); };
      sdk.updateAppMessageShareData({ ...data, desc: preview.description, success, fail: failed });
      sdk.updateTimelineShareData({ ...data, success, fail: failed });
    });
    try { sdk.config({ ...signature, jsApiList: ["updateAppMessageShareData", "updateTimelineShareData"] }); }
    catch { failed(); }
  });
}

export function SharedCardPage() {
  const [view, setView] = useState({ loading: true });
  const [wechatStatus, setWechatStatus] = useState("");
  const [attempt, setAttempt] = useState(0);
  const article = useRef(null);
  useEffect(() => {
    let controller;
    const reset = () => {
      controller?.abort();
      if (article.current) article.current.hidden = true;
      document.title = "知识卡分享 · Concept Discovery";
    };
    async function load() {
      reset();
      setView({ loading: true });
      setWechatStatus("");
      const token = location.hash.slice(1);
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
        setView({ missing: true });
        return;
      }
      controller = new AbortController();
      const { signal } = controller;
      const previewId = previewIdFrom(location.pathname);
      try {
        const card = await readSharedCard(token, previewId, signal);
        if (!signal.aborted) {
          document.title = (card.preview?.title ?? card.title) + " · Concept Discovery";
          setView({ card });
          if (card.wechat && /MicroMessenger/i.test(navigator.userAgent)) {
            setWechatStatus("loading");
            void setWechatShare(token, previewId, signal).then(() => {
              if (!signal.aborted) setWechatStatus("ready");
            }, () => {
              if (!signal.aborted) setWechatStatus("failed");
            });
          }
        }
      } catch (error) {
        if (!signal.aborted) setView(error.status === 404 ? { missing: true } : { failed: true });
      }
    }
    const pagehide = () => {
      reset();
      setView({ loading: true });
    };
    const pageshow = event => { if (event.persisted) void load(); };
    void load();
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("pageshow", pageshow);
    window.addEventListener("hashchange", load);
    return () => {
      reset();
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", pageshow);
      window.removeEventListener("hashchange", load);
    };
  }, [attempt]);

  return <div className="app--reading shared-card">
    <header className="shared-card-brand">
      <img src="/favicon.svg" width="32" height="32" alt="" />
      <span>Concept Discovery</span>
    </header>
    <main className="shared-card-main">
      {view.loading && <p role="status">正在打开知识卡…</p>}
      {view.missing && <h1>此分享链接无效或已撤销</h1>}
      {view.failed && <>
        <h1>暂时无法打开知识卡</h1>
        <Button onClick={() => setAttempt(attempt + 1)}>重试</Button>
      </>}
      {view.card && <article ref={article} className="reader">
        <header className="reader-heading"><h1>{view.card.title}</h1></header>
        {wechatStatus && <p className="shared-card-wechat" role="status">
          {wechatStatus === "loading" ? "正在设置微信转发样式…" : wechatStatus === "ready"
            ? "微信转发样式已就绪，可用右上角菜单转发。" : "微信暂未加载转发样式，仍可分享普通链接。"}
        </p>}
        <div className="prose" dangerouslySetInnerHTML={{ __html: view.card.html }} />
      </article>}
    </main>
  </div>;
}
