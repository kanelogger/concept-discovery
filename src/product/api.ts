export class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) { super(message); }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = await response.json();
  if (!response.ok) throw new ApiError(payload.message || "Request failed", payload.error || "request_failed", response.status);
  return payload as T;
}

