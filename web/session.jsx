import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {takeInitialPage} from "./initial-page.mjs";
import { createWorkspace } from "./workspace.mjs";
import { brand, sessionRequest, SessionPage } from "./session-common.jsx";
import "./session.css";

function loginLocation(expired) {
  const params = new URLSearchParams({ next: location.pathname + location.search });
  if (expired) params.set("expired", "1");
  return `/login?${params}${location.hash}`;
}

function SessionNotice({ view }) {
  return <SessionPage>
    <h1 id="session-heading">{view.heading}</h1>
    <p role={view.retry ? "alert" : "status"}>{view.message}</p>
    {view.retry && <button className="session-primary" type="button" onClick={view.retry}>重试</button>}
  </SessionPage>;
}

const checking = { heading: "正在验证会话", message: "请稍候。" };

export function SessionGate({ Workspace }) {
  const [view, setView] = useState({ notice: checking });
  const shell = useRef(null);
  const runtime = useRef(null);

  useLayoutEffect(() => {
    const host = shell.current;
    let firstPage = takeInitialPage(window);
    const observedLogouts = new Set();
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

    async function verify(firstNavigation = false) {
      const seed = firstNavigation === true ? firstPage : null;
      firstPage = null;
      if (stopped || logoutId || !pagePresent || document.visibilityState === "hidden") return;
      hide();
      setView({ record: active, notice: checking });
      checkingRequest?.abort();
      const controller = new AbortController();
      checkingRequest = controller;
      try {
        // The HTML and its bundle may arrive far apart. A logout or account switch in that
        // interval can precede this tab's BroadcastChannel, so confirm the current owner.
        const session = await sessionRequest("", undefined, controller.signal);
        if (controller.signal.aborted) return;
        if (!session || session.expiresAt <= Date.now()) { leave(true); return; }
        if (!session.publicId || !Number.isFinite(session.expiresAt)) throw new Error("Invalid session response");
        if (observedLogouts.has(session.publicId)) { leave(false); return; }
        if (active?.id !== session.publicId) {
          dispose();
          const record = { id: session.publicId, title: brand };
          record.workspace = createWorkspace({
            sessionId: record.id,
            initialRead: seed?.session?.publicId === session.publicId ? seed.read : undefined,
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
      const id = event.data?.logout;
      if (typeof id !== "string" || !id || id.length > 128) return;
      observedLogouts.add(id);
      if (active?.id === id) leave(false);
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
    void verify(true);
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
