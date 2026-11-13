/* Thin client for the backend (see backend/src/server.js). */

/** Identifies this browser tab, so the server doesn't echo our own writes back to us. */
export const CLIENT_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

/** Call the API. Resolves the JSON body; rejects with an Error carrying `code`, `field` and `status`. */
export async function api(method, path, body) {
  let res;
  try {
    res = await fetch("/api" + path, {
      method,
      credentials: "same-origin",
      headers: { "X-Client-Id": CLIENT_ID, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw Object.assign(new Error("Can’t reach the server. Check that the backend is running, then try again."), { code: "offline" });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    const e = data?.error || {};
    // A proxy answers 5xx without a JSON body when the backend is down.
    const message = e.message || (res.status >= 500 ? "Can’t reach the server. Check that the backend is running, then try again." : "Something went wrong. Try again.");
    throw Object.assign(new Error(message), { code: e.code || (res.status >= 500 ? "offline" : "error"), field: e.field, status: res.status });
  }
  return data;
}
