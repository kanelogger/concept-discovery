export const brand = "Concept Discovery";

export async function sessionRequest(action = "", body, signal) {
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

export function SessionPage({ children }) {
  return <div className="session-page">
    <header className="session-brand">
      <img src="/favicon.svg" width="32" height="32" alt="" />
      <span>{brand}</span>
    </header>
    <main className="session-main" aria-labelledby="session-heading">{children}</main>
  </div>;
}
