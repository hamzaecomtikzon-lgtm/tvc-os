/*
 * A minimal client for Cruva's MCP server (https://mcp.cruva.com/sse?api_key=…).
 * Used for the market-wide tools (other brands' products and videos, video downloads)
 * that the standard REST API doesn't expose. One SSE connection per call batch; the
 * load balancer's sticky cookie is sent back on every POST so the session is found.
 */
const BASE = "https://mcp.cruva.com";

/** Open a session with a workspace's Cruva key, run `fn(call)`, close. `call(name, args)` resolves the tool's text output. */
export async function withCruvaMcp(key, fn) {
  if (!key) throw new Error("This workspace has no Cruva key.");
  const abort = new AbortController();
  const res = await fetch(`${BASE}/sse?api_key=${encodeURIComponent(key)}`, { headers: { Accept: "text/event-stream" }, signal: abort.signal });
  if (!res.ok) throw new Error(`Cruva MCP refused the connection (${res.status}).`);
  const cookie = (res.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");

  const pending = new Map(); // JSON-RPC id → { resolve, reject }
  let endpoint = null;
  let ready;
  const gotEndpoint = new Promise((r) => (ready = r));
  // Read the event stream in the background.
  (async () => {
    const dec = new TextDecoder();
    let buf = "";
    try {
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true }).replace(/\r\n?/g, "\n");
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const event = /^event: ?(.*)$/m.exec(block)?.[1] || "message";
          const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
          if (event === "endpoint") {
            endpoint = new URL(data, BASE).toString();
            ready();
          } else if (data) {
            let msg;
            try { msg = JSON.parse(data); } catch { continue; }
            const p = pending.get(msg.id);
            if (!p) continue;
            pending.delete(msg.id);
            msg.error ? p.reject(new Error(msg.error.message || "Cruva MCP error")) : p.resolve(msg.result);
          }
        }
      }
    } catch { /* closed */ }
    for (const p of pending.values()) p.reject(new Error("Cruva MCP connection closed."));
  })();

  let nextId = 1;
  const post = (body) => fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const rpc = async (method, params, timeoutMs = 90_000) => {
    const id = nextId++;
    const result = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => pending.delete(id) && reject(new Error(`Cruva MCP ${method} timed out.`)), timeoutMs).unref();
    });
    const r = await post({ jsonrpc: "2.0", id, method, params });
    if (!r.ok && r.status !== 202) {
      pending.delete(id);
      throw new Error(`Cruva MCP ${method} failed (${r.status}).`);
    }
    return result;
  };

  try {
    await Promise.race([gotEndpoint, new Promise((_, rej) => setTimeout(() => rej(new Error("Cruva MCP didn't answer.")), 20_000).unref())]);
    await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "kreo", version: "1.0" } });
    await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    const call = async (name, args) => {
      const out = await rpc("tools/call", { name, arguments: args });
      const text = (out?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
      if (out?.isError) throw new Error(text || `Cruva tool ${name} failed.`);
      // Cruva wraps tool output as {"result": "..."}; unwrap when it does.
      try {
        const j = JSON.parse(text);
        if (typeof j?.result === "string") return j.result;
      } catch { /* plain text */ }
      return text;
    };
    return await fn(call);
  } finally {
    abort.abort();
  }
}
