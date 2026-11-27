/*
 * The official KREO bot: the platform's own Discord bot, separate from each brand's community bot.
 *
 *   KREO_DISCORD_BOT_TOKEN   its bot token (Developer Portal → the KREO application → Bot)
 *   KREO_DISCORD_CLIENT_ID   its application id (for the invite link; optional, read from the token otherwise)
 *   KREO_PLATFORM_ADMINS     comma-separated emails of the people who control it (nobody else sees it)
 *   KREO_DISCORD_GATEWAY=off keeps its live connection off (REST still works)
 *
 * It has its own REST client (own token, identity cache and rate-limit retries), its own gateway
 * connection, and its own conversation history (the kreo_messages table). Nothing here reads or writes
 * the brand bot's state, and the brand bot never sees KREO's events.
 *
 *   GET  /api/kreo/status                 identity, connection, invite link, servers
 *   GET  /api/kreo/guilds/<id>/members    people in a server KREO is in (needs the Server Members intent)
 *   POST /api/kreo/dm                     send a test DM { guildId, userId, text, title?, buttonLabel?, buttonUrl? }
 *   GET  /api/kreo/conversations          one row per person KREO has talked to
 *   GET  /api/kreo/conversations/<userId> that person's messages, oldest first
 *   POST /api/kreo/connection             { action: "connect" | "disconnect" | "restart" }
 */
import { createDiscord, DiscordError } from "./discord.js";
import { createGateway, INTENT } from "./gateway.js";
import { sql } from "./store.js";

/**
 * What the invite link asks for in each server: View Channels, Send Messages, Embed Links, Read Message History.
 * KREO only talks in DMs, so it needs nothing that can change a server (no Manage Channels/Roles, no Admin).
 */
export const KREO_PERMISSIONS = String((1 << 10) | (1 << 11) | (1 << 14) | (1 << 16)); // 84992
const COLOR = 0x5b4cf5; // KREO purple, the stripe on its message cards

export const kreo = createDiscord({ tokenVar: "KREO_DISCORD_BOT_TOKEN", clientIdVar: "KREO_DISCORD_CLIENT_ID", invitePermissions: KREO_PERMISSIONS });
// Servers (to know where it is) and direct messages. Server Members is added when it's on in the portal.
export const kreoGateway = createGateway(kreo, { baseIntents: INTENT.GUILDS | INTENT.DMS, offVar: "KREO_DISCORD_GATEWAY", browser: "kreo-official" });

sql.exec(`
  CREATE TABLE IF NOT EXISTS kreo_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL, user_name TEXT NOT NULL DEFAULT '', channel_id TEXT, guild_id TEXT,
    direction TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', title TEXT, button_url TEXT,
    status TEXT NOT NULL, error TEXT, message_id TEXT, sent_by TEXT, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS kreo_messages_user ON kreo_messages (user_id, id);
`);
const q = {
  add: sql.prepare(`INSERT INTO kreo_messages (user_id, user_name, channel_id, guild_id, direction, content, title, button_url, status, error, message_id, sent_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  seen: sql.prepare("SELECT 1 FROM kreo_messages WHERE message_id = ?"),
  history: sql.prepare("SELECT * FROM kreo_messages WHERE user_id = ? ORDER BY id DESC LIMIT ?"),
  people: sql.prepare(`SELECT m.user_id, m.user_name, m.direction, m.content, m.title, m.status, m.created_at,
      (SELECT COUNT(*) FROM kreo_messages c WHERE c.user_id = m.user_id) AS total,
      (SELECT COUNT(*) FROM kreo_messages c WHERE c.user_id = m.user_id AND c.direction = 'in') AS replies
    FROM kreo_messages m WHERE m.id IN (SELECT MAX(id) FROM kreo_messages GROUP BY user_id) ORDER BY m.id DESC LIMIT 200`),
};

/** Servers KREO is in, kept fresh by the gateway (READY / GUILD_CREATE / GUILD_DELETE). */
const live = new Map(); // id → { id, name, members }

/* ---------- who may control it ---------- */
const admins = () => new Set(String(process.env.KREO_PLATFORM_ADMINS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
/** Only the platform owner(s) listed in KREO_PLATFORM_ADMINS. Brand owners and admins never are. */
export const isPlatformAdmin = (user) => Boolean(user?.email && admins().has(String(user.email).toLowerCase()));

/* ---------- shared with creators.js ---------- */
export const KREO_COLOR = COLOR;
export const nameOf = (u) => u?.global_name || u?.username || "";
export const avatarOf = (u) => (u?.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128` : null);
/** A server's name from the live list (null when KREO hasn't seen it). */
export const kreoGuildName = (id) => live.get(id)?.name || null;
/** Save a message in KREO's conversation history. */
export function recordKreo({ userId, name = "", channelId = null, guildId = null, direction = "out", text = "", title = null, buttonUrl = null, status = "sent", error = null, messageId = null, sentBy = null }) {
  return Number(q.add.run(userId, name, channelId, guildId, direction, text, title, buttonUrl, status, error, messageId, sentBy, new Date().toISOString()).lastInsertRowid);
}
/** Called with every DM a person sends KREO (after it's saved). creators.js uses it to answer "join". */
export const kreoDmHooks = [];

/* ---------- live events (KREO's gateway only) ---------- */

export async function onKreoEvent(type, d) {
  if (type === "READY") {
    live.clear();
    for (const g of d.guilds || []) live.set(g.id, { id: g.id, name: g.name || "", members: null });
  } else if (type === "GUILD_CREATE" || type === "GUILD_UPDATE") {
    live.set(d.id, { id: d.id, name: d.name, members: d.member_count ?? live.get(d.id)?.members ?? null });
    inGuildCache.delete(d.id);
  } else if (type === "GUILD_DELETE") {
    if (!d.unavailable) live.delete(d.id);
    inGuildCache.delete(d.id);
  } else if (type === "MESSAGE_CREATE") {
    // A creator writing to KREO in its DMs. Server messages and KREO's own messages are ignored.
    if (d.guild_id || d.author?.bot || q.seen.get(d.id)) return;
    const text = [d.content, ...(d.attachments || []).map((a) => a.url)].filter(Boolean).join("\n");
    q.add.run(d.author.id, nameOf(d.author), d.channel_id, null, "in", text.slice(0, 4000), null, null, "received", null, d.id, null, new Date(Number(BigInt(d.id) >> 22n) + 1420070400000).toISOString());
    for (const hook of kreoDmHooks) await Promise.resolve(hook(d)).catch((e) => console.error("[kreo dm hook]", e.message));
  }
}

/* ---------- reading ---------- */
async function guildList() {
  const rows = await kreo.call("GET", "/users/@me/guilds?with_counts=true");
  return rows.map((g) => ({ id: g.id, name: g.name, members: g.approximate_member_count ?? live.get(g.id)?.members ?? null, icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null }));
}

async function status() {
  const info = await kreo.info();
  const out = {
    configured: kreo.configured(),
    clientIdSet: Boolean((process.env.KREO_DISCORD_CLIENT_ID || "").trim()),
    bot: info.bot || null,
    error: info.error || null,
    inviteUrl: info.inviteUrl || null,
    permissions: KREO_PERMISSIONS,
    gateway: { ...kreoGateway.status, running: kreoGateway.running, off: process.env.KREO_DISCORD_GATEWAY === "off" },
    intents: { members: false, content: false },
    guilds: [],
  };
  if (info.configured) {
    try {
      out.intents = await kreo.intents(); // what the Developer Portal has switched on, whether or not it is connected
      out.guilds = await guildList();
    } catch (e) {
      out.error = e.message;
    }
  }
  return out;
}

async function members(guildId) {
  const list = [];
  try {
    for (let after = "0"; list.length < 5000;) {
      const page = await kreo.call("GET", `/guilds/${guildId}/members?limit=1000&after=${after}`);
      for (const m of page) if (!m.user.bot) list.push({ id: m.user.id, name: m.nick || nameOf(m.user), user: m.user.username, avatar: m.user.avatar ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png?size=64` : null });
      if (page.length < 1000) break;
      after = page[page.length - 1].user.id;
    }
  } catch (e) {
    // Listing members needs the Server Members intent; without it the admin types a user id instead.
    if (e.status === 403) return { members: null, reason: "members_intent" };
    throw e;
  }
  return { members: list.sort((a, b) => a.name.localeCompare(b.name)) };
}

function row(r) {
  return { id: r.id, direction: r.direction, text: r.content, title: r.title, buttonUrl: r.button_url, status: r.status, error: r.error, sentBy: r.sent_by, at: r.created_at, guildId: r.guild_id };
}

/* ---------- sending ---------- */
const recent = new Map(); // admin email → send times, a guard against accidental floods
const LIMIT = 20, WINDOW = 10 * 60_000;
const fail = (status, message, code = "bad_request", field) => Object.assign(new Error(message), { status, code, ...(field ? { field } : {}) });

/** Plain words for Discord's refusals. */
export function why(e) {
  if (e.code === 50007) return "Discord didn’t deliver it: this person has turned off DMs from server members (or blocked KREO). They can turn it on in the server’s Privacy Settings → Direct Messages.";
  if (e.code === 10013) return "Discord doesn’t know that user id.";
  if (e.code === 40003 || e.status === 429) return "Discord is limiting how fast KREO can open new DMs. Wait a minute and try again.";
  if (e.code === "bad_token") return e.message;
  return "Discord refused the message: " + e.message;
}

async function sendTest(user, body) {
  const guildId = String(body.guildId || "").trim();
  const userId = String(body.userId || "").trim();
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 256) : "";
  const buttonLabel = typeof body.buttonLabel === "string" ? body.buttonLabel.trim().slice(0, 80) : "";
  const buttonUrl = typeof body.buttonUrl === "string" ? body.buttonUrl.trim() : "";
  if (!/^\d{17,20}$/.test(userId)) throw fail(400, "Pick a member, or paste their Discord user id (17–20 digits).", "bad_request", "userId");
  if (!/^\d{17,20}$/.test(guildId)) throw fail(400, "Pick the server this person is in.", "bad_request", "guildId");
  if (!text) throw fail(400, "Write the message first.", "bad_request", "text");
  if (text.length > (title ? 4000 : 2000)) throw fail(400, `Keep it under ${title ? "4,000" : "2,000"} characters.`, "bad_request", "text");
  if (buttonUrl && !/^https:\/\/[^\s]{3,500}$/.test(buttonUrl)) throw fail(400, "The button link must start with https://", "bad_request", "buttonUrl");

  const mine = (recent.get(user.email) || []).filter((t) => Date.now() - t < WINDOW);
  if (mine.length >= LIMIT) throw fail(429, `That’s ${LIMIT} test messages in 10 minutes. Wait a few minutes before sending more.`, "rate_limited");

  // Eligible means: a real person who shares a server with KREO. Discord itself then applies their DM settings.
  let member;
  try {
    member = await kreo.call("GET", `/guilds/${guildId}/members/${userId}`);
  } catch (e) {
    if (e instanceof DiscordError && (e.status === 404 || e.code === 10007 || e.code === 10013)) throw fail(400, "That person isn’t in this server, so KREO can’t message them.", "not_member", "userId");
    if (e instanceof DiscordError && (e.status === 403 || e.code === 10004)) throw fail(400, "KREO isn’t in that server.", "not_in_guild", "guildId");
    throw fail(502, why(e), "discord_error");
  }
  if (member.user?.bot) throw fail(400, "That’s a bot account. Pick a person.", "bad_request", "userId");
  const name = member.nick || nameOf(member.user);

  mine.push(Date.now());
  recent.set(user.email, mine);
  const at = new Date().toISOString();
  const payload = title || buttonUrl
    ? {
      ...(title ? { embeds: [{ title, description: text, color: COLOR }] } : { content: text }),
      ...(buttonUrl ? { components: [{ type: 1, components: [{ type: 2, style: 5, label: buttonLabel || "Open", url: buttonUrl }] }] } : {}),
    }
    : { content: text };

  let channelId = null;
  try {
    channelId = (await kreo.call("POST", "/users/@me/channels", { recipient_id: userId })).id;
    const msg = await kreo.call("POST", `/channels/${channelId}/messages`, { ...payload, allowed_mentions: { parse: [] } });
    const id = q.add.run(userId, name, channelId, guildId, "out", text, title || null, buttonUrl || null, "sent", null, msg.id, user.email, at).lastInsertRowid;
    return { ok: true, to: { id: userId, name }, message: { id: Number(id), discordId: msg.id, at }, result: `Delivered to ${name}’s DMs from KREO.` };
  } catch (e) {
    if (!(e instanceof DiscordError)) throw e;
    const error = why(e);
    q.add.run(userId, name, channelId, guildId, "out", text, title || null, buttonUrl || null, "failed", error, null, user.email, at);
    return { ok: false, to: { id: userId, name }, code: e.code ?? null, result: error };
  }
}

/* ---------- for each company: add KREO to their own server ---------- */
const inGuildCache = new Map(); // guildId → { at, value }

/** True when KREO is in the server, false when it isn't, null when Discord couldn't be asked. */
async function kreoIn(guildId, fresh) {
  if (live.has(guildId)) return true;
  const hit = inGuildCache.get(guildId);
  if (!fresh && hit && Date.now() - hit.at < 15_000) return hit.value;
  let value;
  try {
    await kreo.call("GET", `/guilds/${guildId}`);
    value = true;
  } catch (e) {
    value = e instanceof DiscordError && [403, 404].includes(e.status) ? false : null;
  }
  inGuildCache.set(guildId, { at: Date.now(), value });
  return value;
}

/**
 * What a company sees about KREO for its server: whether it's there, and a one-click link that adds it
 * (their server already picked). Never exposes the token. `guildId` is the workspace's own server.
 */
export async function kreoConnection(guildId, { fresh } = {}) {
  if (!kreo.configured()) return { available: false };
  const info = await kreo.info();
  if (!info.configured) return { available: false };
  const out = { available: true, bot: { name: info.bot?.name || "KREO", avatar: info.bot?.avatar || null }, guildId: guildId || null, inGuild: null, inviteUrl: null };
  if (!/^\d{17,20}$/.test(guildId || "")) return out;
  out.inviteUrl = info.inviteUrl ? `${info.inviteUrl}&guild_id=${guildId}&disable_guild_select=true` : null;
  out.inGuild = await kreoIn(guildId, fresh);
  return out;
}

/* ---------- routes (platform admins only) ---------- */
export async function kreoRoute({ p, m, user, readJson }) {
  if (!isPlatformAdmin(user)) throw fail(404, "Not found.", "not_found"); // invisible to everyone else
  if (p === "/api/kreo/status" && m === "GET") return status();
  const mem = /^\/api\/kreo\/guilds\/(\d{17,20})\/members$/.exec(p);
  if (mem && m === "GET") {
    if (!kreo.configured()) throw fail(503, "The KREO bot token isn’t set.", "not_configured");
    return members(mem[1]);
  }
  if (p === "/api/kreo/dm" && m === "POST") {
    if (!kreo.configured()) throw fail(503, "The KREO bot token isn’t set. Add KREO_DISCORD_BOT_TOKEN to the backend’s environment and restart.", "not_configured");
    return sendTest(user, await readJson());
  }
  if (p === "/api/kreo/conversations" && m === "GET") {
    return { conversations: q.people.all().map((r) => ({ userId: r.user_id, name: r.user_name, last: { direction: r.direction, text: r.title || r.content, status: r.status, at: r.created_at }, total: r.total, replies: r.replies })) };
  }
  const conv = /^\/api\/kreo\/conversations\/(\d{17,20})$/.exec(p);
  if (conv && m === "GET") return { messages: q.history.all(conv[1], 200).reverse().map(row) };
  if (p === "/api/kreo/connection" && m === "POST") {
    const { action } = await readJson();
    if (action === "disconnect") kreoGateway.stop();
    else if (action === "connect") await kreoGateway.start(onKreoEvent);
    else if (action === "restart") await kreoGateway.restart();
    else throw fail(400, "Unknown action.");
    console.log(`KREO bot: ${action} by ${user.email}`);
    return status();
  }
  throw fail(404, "Not found.", "not_found");
}

/** Start KREO's live connection (called once at server start). Never throws: KREO is optional. */
export async function startKreo() {
  if (!kreo.configured()) return console.log("KREO bot: not set up (add KREO_DISCORD_BOT_TOKEN to enable it).");
  try {
    const info = await kreo.info();
    console.log(info.configured ? `KREO bot: ${info.bot.name} (${info.bot.id})` : `KREO bot: ${info.error}`);
    if (await kreoGateway.start(onKreoEvent)) console.log(`KREO live events: on (Server Members intent: ${kreoGateway.status.members ? "yes" : "no"})`);
  } catch (e) {
    console.error("KREO bot failed to start:", e.message);
  }
}
