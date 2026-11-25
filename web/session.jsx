import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createWorkspace } from "./workspace.mjs";
import "./session.css";

const brand = "Concept Discovery";
const ended = "会话已过期，请重新登录";
const formErrors = {
  invalid_credentials: "用户名或密码不正确，请重试。",
  rate_limited: "尝试次数过多，请稍后再试。",
};

async function sessionRequest(action = "", body, signal) {
  const response = await fetch(`/api/session${action ? `/${action}` : ""}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: JSON.stringify(body), signal,
  });
  if (response.status === 204) return;
  if (response.status === 401 && body === undefined) return null;
  const result = await response.json();
  if (!response.ok || !result.ok) {
    const error = new Error("Session request failed");
    error.code = result.error?.code;
    throw error;
  }
  return result.data;
}

function returnPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || /^\/\/|[\\\u0000-\u001f\u007f]/.test(value)) return "/cards";
  const target = new URL(value, location.origin);
  if (target.origin !== location.origin || target.pathname === "/login") return "/cards";
  return target.pathname + target.search;
}

function loginLocation(expired) {
  const params = new URLSearchParams({ next: location.pathname + location.search });
  if (expired) params.set("expired", "1");
  return `/login?${params}${location.hash}`;
}

function SessionPage({ children }) {
  return <div className="session-page">
    <header className="session-brand">
      <img src="/favicon.svg" width="32" height="32" alt="" />
      <span>{brand}</span>
    </header>
    <main className="session-main" aria-labelledby="session-heading">{children}</main>
  </div>;
}

function SessionNotice({ view }) {
  return <SessionPage>
    <h1 id="session-heading">{view.heading}</h1>
    <p role={view.retry ? "alert" : "status"}>{view.message}</p>
    {view.retry && <button className="session-primary" type="button" onClick={view.retry}>重试</button>}
  </SessionPage>;
}

export function LoginPage() {
  const [revealed, setRevealed] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const usernameInput = useRef(null);
  const pending = useRef(null);
  const params = new URLSearchParams(location.search);
  const expired = params.get("expired") === "1";
  useLayoutEffect(() => {
    document.title = `登录知识库 · ${brand}`;
    usernameInput.current?.focus();
  }, []);
  useEffect(() => () => pending.current?.abort(), []);

  async function submit(event) {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setMessage("");
    let navigating = false;
    try {
      const { target } = await sessionRequest("login", {
        username: fields.get("username"), password: fields.get("password"), target: returnPath(params.get("next")),
      }, controller.signal);
      controller.signal.throwIfAborted();
      location.replace(returnPath(target) + location.hash);
      navigating = true;
    } catch (error) {
      if (!controller.signal.aborted) {
        setMessage(formErrors[error.code] ?? "暂时无法登录，请检查网络后重试。");
        form.elements.password.focus();
      }
    } finally {
      form.elements.password.value = "";
      setRevealed(false);
      if (!navigating) {
        pending.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }

  return <SessionPage>
    <h1 id="session-heading">登录知识库</h1>
    {expired && <p id="session-instruction">{ended}</p>}
    <form className="session-form" method="post" onSubmit={submit}
      aria-busy={busy} aria-describedby={expired ? "session-instruction" : undefined}>
      <div className="session-field">
        <label htmlFor="login-username">用户名</label>
        <input id="login-username" ref={usernameInput} name="username" autoComplete="username"
          autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={120} required readOnly={busy} />
      </div>
      <div className="session-field">
        <label htmlFor="login-password">密码</label>
        <div className="session-password">
          <input id="login-password" name="password" type={revealed ? "text" : "password"} autoComplete="current-password"
            spellCheck={false} required readOnly={busy} aria-describedby={message ? "session-message" : undefined} />
          <button type="button" disabled={busy} aria-controls="login-password" onClick={() => setRevealed(value => !value)}>
            {revealed ? "隐藏密码" : "显示密码"}
          </button>
        </div>
      </div>
      {message && <p id="session-message" role="alert" className="session-error">{message}</p>}
      <button className="session-primary" type="submit" disabled={busy}>{busy ? "正在登录…" : "登录"}</button>
    </form>
  </SessionPage>;
}

const checking = { heading: "正在验证会话", message: "请稍候。" };

export function SessionGate({ Workspace }) {
  const [view, setView] = useState({ notice: checking });
  const shell = useRef(null);
  const runtime = useRef(null);

  useLayoutEffect(() => {
    const host = shell.current;
    const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("concept-discovery.session") : null;
    let active, checkingRequest, expiryTimer, logoutId, logoutRequest;
    let pagePresent = true;
    let stopped = false;
    let locked = true;

    function hide() {
      if (!locked && active && host.contains(document.activeElement)) active.focus = document.activeElement;
      locked = true;
      host.hidden = true;
      document.title = brand;
    }
    function dispose() {
      hide();
      clearTimeout(expiryTimer);
      active?.workspace.destroy();
      active = null;
    }
    function leave(expired) {
      checkingRequest?.abort();
      dispose();
      setView({ notice: expired ? { heading: "会话已过期", message: "正在返回登录页。" } :
        { heading: "已退出登录", message: "正在返回登录页。" } });
      location.replace(loginLocation(expired));
    }
    function onExpired(publicId) {
      if (active?.id === publicId) leave(true);
    }

    async function verify() {
      if (stopped || logoutId || !pagePresent || document.visibilityState === "hidden") return;
      hide();
      setView({ record: active, notice: checking });
      checkingRequest?.abort();
      const controller = new AbortController();
      checkingRequest = controller;
      try {
        const session = await sessionRequest("", undefined, controller.signal);
        if (controller.signal.aborted) return;
        if (!session || session.expiresAt <= Date.now()) { leave(true); return; }
        if (!session.publicId || !Number.isFinite(session.expiresAt)) throw new Error("Invalid session response");
        if (active?.id !== session.publicId) {
          dispose();
          const record = { id: session.publicId, title: brand };
          record.workspace = createWorkspace({
            sessionId: record.id,
            onUnauthorized: () => onExpired(record.id),
            setTitle(title) {
              record.title = title;
              if (active === record && !locked) document.title = title;
            },
          });
          active = record;
        }
        clearTimeout(expiryTimer);
        expiryTimer = setTimeout(() => onExpired(session.publicId), session.expiresAt - Date.now());
        setView({ record: active, logout });
      } catch {
        if (!controller.signal.aborted) {
          dispose();
          setView({ notice: { heading: "暂时无法验证会话", message: "请检查连接后重试。", retry: verify } });
        }
      }
    }

    async function logout() {
      if (stopped || logoutRequest) return;
      logoutId ??= active?.id;
      if (!logoutId) return;
      checkingRequest?.abort();
      dispose();
      setView({ notice: { heading: "正在退出登录", message: "请稍候。" } });
      const controller = new AbortController();
      logoutRequest = controller;
      try {
        await sessionRequest("logout", { publicId: logoutId }, controller.signal);
        if (!controller.signal.aborted) {
          channel?.postMessage({ logout: logoutId });
          leave(false);
        }
      } catch {
        if (!controller.signal.aborted) setView({ notice: {
          heading: "退出尚未完成", message: "无法确认会话已结束。请检查连接后重试。", retry: logout,
        } });
      } finally { logoutRequest = null; }
    }

    function pagehide() {
      pagePresent = false;
      checkingRequest?.abort();
      hide();
    }
    function pageshow(event) {
      pagePresent = true;
      if (event.persisted) void verify();
    }
    function visibility() {
      if (document.visibilityState === "hidden") {
        checkingRequest?.abort();
        hide();
      } else void verify();
    }
    function sharedLogout(event) {
      if (active && event.data?.logout === active.id) leave(false);
    }
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("pageshow", pageshow);
    window.addEventListener("focus", verify);
    window.addEventListener("popstate", verify);
    document.addEventListener("visibilitychange", visibility);
    channel?.addEventListener("message", sharedLogout);
    runtime.current = { reveal(record) {
      if (active !== record || !pagePresent || document.visibilityState === "hidden") return;
      locked = false;
      host.hidden = false;
      document.title = record.title;
      if (record.focus?.isConnected) record.focus.focus({ preventScroll: true });
      record.focus = null;
    } };
    void verify();
    return () => {
      stopped = true;
      checkingRequest?.abort();
      logoutRequest?.abort();
      dispose();
      channel?.close();
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", pageshow);
      window.removeEventListener("focus", verify);
      window.removeEventListener("popstate", verify);
      document.removeEventListener("visibilitychange", visibility);
      runtime.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (view.record && !view.notice) runtime.current?.reveal(view.record);
  }, [view]);

  return <>
    <div ref={shell} hidden data-private-workspace>
      {view.record && <Workspace key={view.record.id} workspace={view.record.workspace} onLogout={view.logout} />}
    </div>
    {view.notice && <SessionNotice view={view.notice} />}
  </>;
}
