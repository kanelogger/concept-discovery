import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { brand, sessionRequest, SessionPage } from "./session-common.jsx";
export { default as stylesheet } from "./login.css?route";

const ended = "会话已过期，请重新登录";
const formErrors = {
  invalid_credentials: "用户名或密码不正确，请重试。",
  rate_limited: "尝试次数过多，请稍后再试。",
};

function returnPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || /^\/\/|[\\\u0000-\u001f\u007f]/.test(value)) return "/cards";
  const target = new URL(value, location.origin);
  if (target.origin !== location.origin || target.pathname === "/login") return "/cards";
  return target.pathname + target.search;
}

export default function LoginPage() {
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
