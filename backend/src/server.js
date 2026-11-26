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
 *   GET  /api/media/<id>.png                     a generated card image (public, unguessable id)
 */
import "./env.js";
import { createServer } from "node:http";
import { auth } from "./auth.js";
import { store } from "./store.js";
import { discord } from "./discord.js";
import { crmFor, crmSource, cruvaKeyFor, forgetCruvaKey, verifyCruvaKey } from "./crm.js";
import { crmKeys } from "./crmKeys.js";
import { cfgOf, claimedByOther, startJob, startScheduler } from "./jobs.js";
import { gateway } from "./gateway.js";
import { onEvent } from "./bot.js";
import { ai } from "./ai.js";
import { DEFAULT_THEME, brandInfo } from "./brandTheme.js";
import * as audit from "./audit.js";

/** Record a sign-in or sign-up in the workspace's audit log, then hand the user back. `action` is auth.signin, auth.signup or auth.join. */
function signedIn(user, action, label, how) {
  audit.log(user.workspace, audit.actorOf(user), { category: "security", action, label, summary: how });
  return user;
}

const PORT = Number(process.env.PORT) || 8787;
const MAX_BODY = 1024 * 1024;
// Collections the browser may write. Everything else (discord, requests, activity…) is written by the server.
const WRITABLE = ["workspace", "config", "automations", "allowlist", "scoring", "onboarding", "drafts", "custom"];
// What each role may do besides reading. Viewers only read.
const MOD_JOBS = ["post", "reject", "test", "dm", "dm_read", "draft", "dm_link", "dm_status", "welcome"];
const PATH_RE = /^([a-z_]+)\/([A-Za-z0-9_.-]{1,80})$/;

const fail = (status, message, code = "bad_request", field) => Object.assign(new Error(message), { status, code, ...(field ? { field } : {}) });

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

  if (p === "/api/auth/signup" && m === "POST") {
    const u = auth.signUp(res, await readJson(req));
    return send(res, 200, { user: u.role === "Owner" ? signedIn(u, "auth.signup", u.brand, "Signed up and created the workspace") : signedIn(u, "auth.join", u.role, `Joined the team as ${u.role}`) });
  }
  if (p === "/api/auth/signin" && m === "POST") return send(res, 200, { user: signedIn(auth.signIn(res, await readJson(req)), "auth.signin", "Email & password", "Signed in with email and password") });
  if (p === "/api/auth/signout" && m === "POST") {
    const u = auth.user(req);
    if (u) audit.log(u.workspace, audit.actorOf(u), { category: "security", action: "auth.signout", label: "Session", summary: "Signed out" });
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
        signedIn(await auth.googleFinish(req, res, { code: url.searchParams.get("code"), state: url.searchParams.get("state") }, back), "auth.signin", "Google", "Signed in with Google");
      } catch (e) {
        if (!e.status) console.error("[google sign-in]", e);
        to = "/?auth_error=" + encodeURIComponent(e.status ? e.message : "Google sign-in failed. Try again.") + "#signin";
      }
      res.writeHead(302, { Location: to, "Cache-Control": "no-store" });
      return res.end();
    }
  }
  if (p === "/api/auth/me" && m === "GET") return send(res, 200, { user: auth.user(req) });

  // Generated cards (winning angle). Public by unguessable id so <img> tags work without auth headers.
  if (p.startsWith("/api/media/") && m === "GET") {
    const file = store.media(p.slice("/api/media/".length).replace(/\.png$/, ""));
    if (!file) throw fail(404, "Not found.", "not_found");
    res.writeHead(200, { "Content-Type": file.mime, "Cache-Control": "public, max-age=31536000, immutable" });
    return res.end(file.data);
  }

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
  const me = audit.actorOf(user);
  const record = (e) => audit.log(ns, me, e);

  // Audit log: who did what, and when. Owners and admins only.
  if (p === "/api/audit" && m === "GET") {
    needAdmin();
    const s = url.searchParams;
    const page = audit.list(ns, {
      category: s.get("category"), actor: s.get("actor"), action: s.get("action"), shop: s.get("shop"), platform: s.get("platform"),
      q: s.get("q"), before: s.get("before"), from: s.get("from"), to: s.get("to"), limit: s.get("limit"),
    });
    // Shop names and regions come from the CRM (cached); entries only keep the shop's id.
    let shops = {};
    try {
      shops = Object.fromEntries((await crmFor(ns).listShops()).map((x) => [x.id, { name: x.name, region: x.region }]));
    } catch { /* the CRM is down: show ids */ }
    const shopOf = (id) => (id ? { id, name: shops[id]?.name || id, region: shops[id]?.region || "" } : null);
    const entries = page.entries.map((e) => ({ ...e, shop: shopOf(e.shopId), target: e.action === "shop.switch" ? shopOf(e.target)?.name || e.target : e.target }));
    const f = s.get("before") ? null : audit.facets(ns);
    return send(res, 200, { entries, next: page.next, categories: audit.CATEGORIES, ...(f ? { ...f, shops: f.shops.map(shopOf) } : {}) });
  }

  if (p === "/api/config" && m === "GET") return send(res, 200, { discord: await discord.info(), gateway: gateway.status, ai: ai.configured(), crm: crmSource(ns), crmConnection: crmKeys.info(ns) });

  // The workspace's own CRM key. The key goes in once and never comes back out: reads return only its last 4 characters.
  if (p === "/api/crm-connection" && m === "GET") return send(res, 200, { connection: crmKeys.info(ns), source: crmSource(ns) });
  if (p === "/api/crm-connection" && m === "PUT") {
    needAdmin();
    const { provider, apiKey } = await readJson(req);
    if (provider !== "cruva") throw fail(400, "Only Cruva can be connected for now. Euka and Reacher are coming.", "provider_unavailable");
    const key = typeof apiKey === "string" ? apiKey.trim() : "";
    if (key.length < 16 || key.length > 512 || /\s/.test(key)) throw fail(400, "That doesn’t look like a Cruva API key. Copy the whole key from Cruva → Settings → API.", "bad_key", "apiKey");
    const shops = await verifyCruvaKey(key);
    const had = crmKeys.info(ns);
    forgetCruvaKey(cruvaKeyFor(ns));
    crmKeys.save(ns, "cruva", key, shops.length);
    record({ category: "security", action: had ? "crm.key_change" : "crm.connect", label: `Cruva (key …${key.slice(-4)})`, summary: `${had ? "Replaced" : "Connected"} the Cruva API key (ending ${key.slice(-4)}, ${shops.length} shop${shops.length === 1 ? "" : "s"})` });
    return send(res, 200, { connection: crmKeys.info(ns), source: crmSource(ns), shops: await crmFor(ns).listShops() });
  }
  if (p === "/api/crm-connection" && m === "DELETE") {
    needAdmin();
    const had = crmKeys.info(ns);
    forgetCruvaKey(crmKeys.key(ns, "cruva"));
    crmKeys.remove(ns);
    if (had) record({ category: "security", action: "crm.disconnect", label: `Cruva (key …${had.last4})`, summary: `Disconnected Cruva (key ending ${had.last4}). Cards and automations fall back to sample data.` });
    return send(res, 200, { connection: null, source: crmSource(ns) });
  }

  if (p === "/api/ai/automation" && m === "POST") {
    if (!ai.configured()) throw fail(503, "The AI builder isn’t set up on the server.", "ai_off");
    const { gid, spec, chat, message, channels } = await readJson(req);
    if (typeof message !== "string" || !message.trim() || !spec || typeof spec !== "object") throw fail(400, "Send a message and the current automation.");
    const cfg = gid ? cfgOf(ns, String(gid)) : {};
    const owner = store.owner(ns);
    try {
      const out = await ai.buildAutomation({
        brand: owner?.brand || "the brand", botName: cfg.botName || "the bot", voice: cfg.tone || "",
        channels: (Array.isArray(channels) ? channels : []).slice(0, 200).map((c) => ({ id: String(c.id), name: String(c.name).slice(0, 100) })),
        spec, chat: Array.isArray(chat) ? chat.filter((x) => Array.isArray(x) && typeof x[1] === "string") : [], message: message.slice(0, 2000),
      });
      if (!out) throw fail(422, "The builder couldn’t help with that one. Try describing it differently.", "ai_declined");
      return send(res, 200, out);
    } catch (e) {
      if (e.status && e.code) throw e;
      console.error("[ai builder]", e);
      throw fail(502, "The AI builder didn’t answer. Try again in a moment.", "ai_error");
    }
  }

  // The colors generated cards use, read automatically from the uploaded company picture.
  if (p === "/api/brand" && m === "GET") {
    const { detected, source } = brandInfo(store.get(ns, "workspace/main") || {});
    return send(res, 200, { detected, source, default: { primary: DEFAULT_THEME.green, secondary: DEFAULT_THEME.red } });
  }
  // The colors a logo would give the cards, before it's saved (the Workspace preview).
  if (p === "/api/brand/preview" && m === "POST") {
    const { logo } = await readJson(req);
    if (typeof logo !== "string" || !/^data:image\/(png|jpeg);base64,/.test(logo)) throw fail(400, "Send a PNG or JPEG logo.", "bad_request", "logo");
    const { detected, source } = brandInfo({ brand: { logo } });
    return send(res, 200, { detected, source, default: { primary: DEFAULT_THEME.green, secondary: DEFAULT_THEME.red } });
  }

  // AI Community Builder: design a server layout from a description of the community.
  if (p === "/api/ai/community" && m === "POST") {
    needAdmin();
    if (!ai.configured()) throw fail(503, "The AI designer isn’t set up on the server. Pick one of the ready-made templates instead.", "ai_off");
    const { description } = await readJson(req);
    if (typeof description !== "string" || description.trim().length < 10) throw fail(400, "Describe your community in a sentence or two first.", "bad_request", "description");
    try {
      const out = await ai.communityTemplate({ brand: user.brand, description: description.trim().slice(0, 1500) });
      if (!out) throw fail(422, "The AI couldn’t design a layout from that. Try describing it differently.", "ai_declined");
      return send(res, 200, out);
    } catch (e) {
      if (e.status && e.code) throw e;
      console.error("[ai community]", e);
      throw fail(502, "The AI designer didn’t answer. Try again in a moment, or pick a ready-made template.", "ai_error");
    }
  }

  if (p === "/api/account" && m === "PUT") {
    const next = auth.update(user, await readJson(req));
    if (next.brand !== user.brand) record({ category: "settings", action: "brand.rename", label: next.brand, summary: `Renamed the brand from “${user.brand}” to “${next.brand}”` });
    if (next.name !== user.name) audit.log(ns, audit.actorOf(next), { category: "team", action: "profile.rename", label: next.name, summary: `Changed their name from “${user.name}” to “${next.name}”` });
    return send(res, 200, { user: next });
  }
  if (p === "/api/team" && m === "GET") return send(res, 200, auth.team(ns));
  if (p === "/api/team" && m === "POST") {
    needAdmin();
    const body = await readJson(req);
    auth.invite(ns, body);
    record({ category: "team", action: "team.invite", label: String(body.email).trim().toLowerCase(), summary: `Invited ${String(body.email).trim().toLowerCase()} as ${body.role}` });
    return send(res, 200, auth.team(ns));
  }
  if (p.startsWith("/api/team/") && (m === "PUT" || m === "DELETE")) {
    needAdmin();
    const email = decodeURIComponent(p.slice("/api/team/".length)).toLowerCase();
    const t = auth.team(ns);
    const member = t.members.find((x) => x.email === email), invite = t.invites.find((x) => x.email === email);
    if (m === "PUT") {
      const { role } = await readJson(req);
      auth.setRole(ns, email, role);
      const was = (member || invite)?.role;
      if (was && was !== role) record({ category: "team", action: "team.role", label: `${email}: ${was} → ${role}`, summary: `Changed ${member ? member.name + " (" + email + ")" : email + "’s invite"} from ${was} to ${role}` });
    } else {
      auth.remove(ns, email);
      if (member) record({ category: "team", action: "team.remove", label: email, summary: `Removed ${member.name} (${email}, ${member.role}) from the team` });
      else if (invite) record({ category: "team", action: "team.uninvite", label: email, summary: `Cancelled the invite for ${email}` });
    }
    return send(res, 200, auth.team(ns));
  }

  if (p === "/api/docs" && m === "GET") return send(res, 200, { docs: store.all(ns) });
  if (p === "/api/docs" && m === "DELETE") {
    needAdmin();
    forgetCruvaKey(crmKeys.key(ns, "cruva"));
    crmKeys.remove(ns); // deleting the workspace also deletes its saved CRM key
    store.clear(ns);
    // The audit log is kept on purpose: a reset is exactly the kind of thing it's for.
    record({ category: "security", action: "workspace.reset", label: user.brand, summary: "Reset the workspace: deleted all settings, drafts, automations and the saved CRM key" });
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
    const before = store.get(ns, path);
    store.set(ns, path, doc, cid);
    for (const e of audit.describeDoc(ns, path, before, doc)) record(e);
    return send(res, 200, {});
  }
  if (p.startsWith("/api/docs/") && m === "DELETE") {
    needAdmin();
    const path = docPath(url);
    const before = store.get(ns, path);
    store.remove(ns, path, cid);
    if (before) for (const e of audit.describeDoc(ns, path, before, null)) record(e);
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
    const job = startJob(ns, String(type), data, me); // the audit log's "who" comes from the session, never the browser
    return send(res, 200, wait ? { id: job.id, ...(await job.done) } : { id: job.id, status: "working" });
  }

  if (p.startsWith("/api/crm/") && m === "POST") {
    const tool = p.slice("/api/crm/".length);
    const tools = crmFor(ns);
    if (!Object.hasOwn(tools, tool)) throw fail(404, "Unknown CRM call.");
    return send(res, 200, { data: await tools[tool](await readJson(req)) });
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
