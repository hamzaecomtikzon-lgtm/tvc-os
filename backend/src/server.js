/*
 * Kreo API server.
 *
 *   POST /api/auth/signup | signin | signout     GET /api/auth/me
 *   GET  /api/config                             what's connected (Discord bot, invite link)
 *   GET  /api/docs                               every document of the signed-in account
 *   PUT  /api/docs/<collection>/<id>             DELETE the same, or DELETE /api/docs to reset
 *   GET  /api/events                             live document changes (server-sent events)
 *   POST /api/requests                           ask the bot to do something (see jobs.js)
 *   POST /api/crm/<tool>                         CRM data (see crm.js)
 */
import "./env.js";
import { createServer } from "node:http";
import { auth } from "./auth.js";
import { store } from "./store.js";
import { discord } from "./discord.js";
import { crm } from "./crm.js";
import { claimedByOther, startJob, startScheduler } from "./jobs.js";
import { gateway } from "./gateway.js";
import { onEvent } from "./bot.js";
import { ai } from "./ai.js";

const PORT = Number(process.env.PORT) || 8787;
const MAX_BODY = 1024 * 1024;
// Collections the browser may write. Everything else (discord, requests, activity…) is written by the server.
const WRITABLE = ["workspace", "config", "automations", "allowlist", "scoring", "onboarding", "drafts", "custom"];
// What each role may do besides reading. Viewers only read.
const MOD_JOBS = ["post", "reject", "test", "dm", "dm_read", "draft"];
const PATH_RE = /^([a-z_]+)\/([A-Za-z0-9_.-]{1,80})$/;

const fail = (status, message, code = "bad_request") => Object.assign(new Error(message), { status, code });

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  if (!/^application\/json/.test(req.headers["content-type"] || "")) throw fail(415, "Send JSON.");
  let size = 0;
  const parts = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw fail(413, "That’s too large to save.");
    parts.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8") || "{}");
  } catch {
    throw fail(400, "Invalid JSON.");
  }
}

function docPath(url) {
  const path = decodeURIComponent(url.pathname.slice("/api/docs/".length));
  const m = PATH_RE.exec(path);
  if (!m) throw fail(400, "Invalid document path.");
  if (!WRITABLE.includes(m[1])) throw fail(403, "This document is read-only.", "read_only");
  return path;
}

/* ---------- live updates ---------- */
const streams = new Set(); // { ns, cid, res }
store.subscribe((ns, path, doc, origin) => {
  const line = `data: ${JSON.stringify({ path, doc })}\n\n`;
  for (const s of streams) if (s.ns === ns && s.cid !== origin) s.res.write(line);
});
setInterval(() => streams.forEach((s) => s.res.write(": ping\n\n")), 25_000).unref();

/* ---------- routes ---------- */
async function route(req, res) {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;
  const m = req.method;

  if (p === "/api/auth/signup" && m === "POST") return send(res, 200, { user: auth.signUp(res, await readJson(req)) });
  if (p === "/api/auth/signin" && m === "POST") return send(res, 200, { user: auth.signIn(res, await readJson(req)) });
  if (p === "/api/auth/signout" && m === "POST") {
    auth.signOut(req, res);
    return send(res, 200, {});
  }
  if (p.startsWith("/api/auth/google")) {
    // The address Google sends the browser back to: this site's own address (the browser tells us, because
    // a dev proxy hides it), remembered in a cookie for the way back. It must be listed in the Google Cloud console.
    const origin = url.searchParams.get("origin") || decodeURIComponent((req.headers.cookie || "").match(/(?:^|;\s*)kreo_origin=([^;]+)/)?.[1] || "");
    const site = /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin) ? origin : `http://${req.headers.host}`;
    const back = process.env.GOOGLE_REDIRECT_URI || site + "/api/auth/google/callback";
    if (p === "/api/auth/google/url" && m === "GET") {
      const to = auth.googleUrl(res, back);
      res.setHeader("Set-Cookie", [res.getHeader("Set-Cookie"), `kreo_origin=${encodeURIComponent(site)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`].flat());
      return send(res, 200, { url: to });
    }
    if (p === "/api/auth/google/callback" && m === "GET") {
      let to = "/#dashboard";
      try {
        if (url.searchParams.get("error")) throw fail(400, "Google sign-in was cancelled.");
        await auth.googleFinish(req, res, { code: url.searchParams.get("code"), state: url.searchParams.get("state") }, back);
      } catch (e) {
        if (!e.status) console.error("[google sign-in]", e);
        to = "/?auth_error=" + encodeURIComponent(e.status ? e.message : "Google sign-in failed. Try again.") + "#signin";
      }
      res.writeHead(302, { Location: to, "Cache-Control": "no-store" });
      return res.end();
    }
  }
  if (p === "/api/auth/me" && m === "GET") return send(res, 200, { user: auth.user(req) });

  // Local tests feed gateway events in by hand (never enabled in normal runs).
  if (process.env.KREO_TEST_EVENTS === "1" && p === "/api/_test/event" && m === "POST") {
    const { type, data } = await readJson(req);
    await onEvent(type, data);
    return send(res, 200, {});
  }

  const user = auth.user(req);
  if (!user) throw fail(401, "Sign in first.", "signed_out");
  const ns = user.workspace;
  const cid = String(req.headers["x-client-id"] || "");
  const admin = user.role === "Owner" || user.role === "Admin";
  const needAdmin = () => { if (!admin) throw fail(403, "Your role can’t change this. Ask the workspace owner.", "forbidden"); };

  if (p === "/api/config" && m === "GET") return send(res, 200, { discord: await discord.info(), gateway: gateway.status, ai: ai.configured() });

  if (p === "/api/account" && m === "PUT") return send(res, 200, { user: auth.update(user, await readJson(req)) });
  if (p === "/api/team" && m === "GET") return send(res, 200, auth.team(ns));
  if (p === "/api/team" && m === "POST") {
    needAdmin();
    auth.invite(ns, await readJson(req));
    return send(res, 200, auth.team(ns));
  }
  if (p.startsWith("/api/team/") && (m === "PUT" || m === "DELETE")) {
    needAdmin();
    const email = decodeURIComponent(p.slice("/api/team/".length)).toLowerCase();
    if (m === "PUT") auth.setRole(ns, email, (await readJson(req)).role);
    else auth.remove(ns, email);
    return send(res, 200, auth.team(ns));
  }

  if (p === "/api/docs" && m === "GET") return send(res, 200, { docs: store.all(ns) });
  if (p === "/api/docs" && m === "DELETE") {
    needAdmin();
    store.clear(ns);
    return send(res, 200, {});
  }
  if (p.startsWith("/api/docs/") && m === "PUT") {
    const path = docPath(url);
    if (!path.startsWith("drafts/") || user.role === "Viewer") needAdmin();
    const { doc } = await readJson(req);
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw fail(400, "A document must be an object.");
    if (path === "workspace/main" && doc.guildId) {
      if (!store.get(ns, "discord/" + doc.guildId) || claimedByOther(ns, doc.guildId)) throw fail(409, "That server isn’t available.", "guild_unavailable");
    }
    store.set(ns, path, doc, cid);
    return send(res, 200, {});
  }
  if (p.startsWith("/api/docs/") && m === "DELETE") {
    needAdmin();
    store.remove(ns, docPath(url), cid);
    return send(res, 200, {});
  }

  if (p === "/api/events" && m === "GET") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write("retry: 2000\n\n");
    const s = { ns, cid: url.searchParams.get("cid") || "", res };
    streams.add(s);
    req.on("close", () => streams.delete(s));
    return;
  }

  if (p === "/api/requests" && m === "POST") {
    const { type, payload, wait } = await readJson(req);
    if (!MOD_JOBS.includes(type) || user.role === "Viewer") needAdmin();
    const data = payload && typeof payload === "object" ? payload : {};
    if (type === "post" || type === "reject") data.by = user.name; // who approved is never taken from the browser
    const job = startJob(ns, String(type), data);
    return send(res, 200, wait ? { id: job.id, ...(await job.done) } : { id: job.id, status: "working" });
  }

  if (p.startsWith("/api/crm/") && m === "POST") {
    const tool = p.slice("/api/crm/".length);
    if (!Object.hasOwn(crm, tool)) throw fail(404, "Unknown CRM call.");
    return send(res, 200, { data: crm[tool](await readJson(req)) });
  }

  throw fail(404, "Not found.", "not_found");
}

createServer((req, res) => {
  route(req, res).catch((e) => {
    if (!e.status) console.error(e);
    if (res.headersSent) return res.end();
    send(res, e.status || 500, { error: { message: e.status ? e.message : "Something went wrong on the server.", code: e.code || "server_error", field: e.field } });
  });
}).on("error", (e) => {
  if (e.code !== "EADDRINUSE") throw e;
  console.error(`Port ${PORT} is already in use: another copy of the backend is running.\nStop it with:  kill $(lsof -ti tcp:${PORT})\nthen run npm start again.`);
  process.exit(1);
}).listen(PORT, () => {
  console.log(`Kreo API on http://localhost:${PORT}`);
  discord.info().then((d) => console.log(d.configured ? `Discord bot: ${d.bot.name} (${d.bot.id})` : `Discord: not connected. ${d.error || "Add DISCORD_BOT_TOKEN to backend/.env."}`));
});
startScheduler();
gateway.start(onEvent).then((started) => {
  if (!started) return;
  const g = gateway.status;
  console.log(g.error ? `Discord live events: ${g.error}` : `Discord live events: on (member joins: ${g.members ? "yes" : "no, Server Members Intent is off"}; message text: ${g.content ? "yes" : "no, Message Content Intent is off"})`);
});
// Bring each workspace's channels and member list up to date.
if (discord.configured()) for (const { ns, ws } of store.workspaces()) if (ws.guildId) startJob(ns, "sync");
