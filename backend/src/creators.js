/*
 * The KREO creator database: creators who joined through the official KREO bot.
 *
 * How someone gets in:
 *   1. A platform admin sends a KREO invite DM (a "Join KREO" button) to members of a server KREO is in.
 *      The button carries a signed link: who they are on Discord and which server they came from.
 *   2. The link opens the join page in the app (#join/<token>). No account: the link is the identity.
 *      They enter their TikTok handle, niche and country and agree that brands can find them.
 *   3. They're saved here, and their numbers (30-day GMV, sales, videos) are read from the CRM of the
 *      brand whose server they came from, with their TikTok level (levels.js: L0 Bronze … L7 Diamond).
 * Creators can come back to the same link to update their details or leave (which hides them).
 * Anyone who messages KREO "join" gets a fresh link, and (when on) new members of a server KREO is in get
 * the invite automatically: only people who join from now on, never everyone already there.
 * Joined creators' numbers are refreshed from the CRM once a day.
 *
 * Sample creators (sample = 1) are made-up rows for testing search. They aren't real Discord users,
 * so they can never be messaged, and one call removes them all.
 *
 *   GET    /api/join/<token>                public: who the link is for, their saved details
 *   POST   /api/join/<token>                public: { tiktok, niche, country, consent } or { leave: true }
 *   GET    /api/kreo/creators               platform admins: the database (?q=&niche=&level=&show=real|sample|all)
 *   POST   /api/kreo/invite                 platform admins: { guildId, userIds[], appUrl } → sends the invite DMs
 *   POST   /api/kreo/creators/samples       platform admins: (re)load the sample creators
 *   DELETE /api/kreo/creators/samples       platform admins: remove every sample creator
 *   POST   /api/kreo/creators/<id>/refresh  platform admins: re-read their numbers from the CRM
 *   DELETE /api/kreo/creators/<id>          platform admins: delete one creator
 *   GET|PUT /api/kreo/settings              platform admins: { autoInvite }
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { sql, store } from "./store.js";
import { deriveKey } from "./crmKeys.js";
import { LEVELS, levelOf, normalizeLevel } from "./levels.js";
import { crmFor, crmSource } from "./crm.js";
import { addDays, todayUTC, ymd } from "./dates.js";
import { DiscordError } from "./discord.js";
import { KREO_COLOR, avatarOf, isPlatformAdmin, kreo, kreoDmHooks, kreoGuildName, kreoMemberHooks, nameOf, recordKreo, why } from "./kreo.js";

export const NICHES = ["Health & wellness", "Beauty & skincare", "Fashion", "Fitness", "Food & drink", "Home & kitchen", "Tech & gadgets", "Pets", "Baby & kids", "Lifestyle", "Other"];
export const COUNTRIES = [["US", "United States"], ["GB", "United Kingdom"], ["CA", "Canada"], ["AU", "Australia"], ["DE", "Germany"], ["FR", "France"], ["IT", "Italy"], ["ES", "Spain"], ["MX", "Mexico"], ["BR", "Brazil"], ["PH", "Philippines"], ["MY", "Malaysia"], ["ID", "Indonesia"], ["TH", "Thailand"], ["VN", "Vietnam"], ["SG", "Singapore"], ["PK", "Pakistan"], ["IN", "India"], ["AE", "United Arab Emirates"], ["SA", "Saudi Arabia"], ["OTHER", "Somewhere else"]];

export { LEVELS, levelOf } from "./levels.js";

sql.exec(`
  CREATE TABLE IF NOT EXISTS kreo_creators (
    id TEXT PRIMARY KEY,
    discord_name TEXT NOT NULL DEFAULT '', discord_user TEXT NOT NULL DEFAULT '', avatar TEXT,
    tiktok TEXT, niche TEXT, country TEXT, consent INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    source_guild TEXT, source_guild_name TEXT, guilds TEXT NOT NULL DEFAULT '[]',
    metrics TEXT, level INTEGER, sample INTEGER NOT NULL DEFAULT 0,
    invited_at TEXT, invited_by TEXT, joined_at TEXT, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS kreo_creators_tiktok ON kreo_creators (tiktok);
`);
const q = {
  get: sql.prepare("SELECT * FROM kreo_creators WHERE id = ?"),
  all: sql.prepare("SELECT * FROM kreo_creators ORDER BY sample, COALESCE(joined_at, invited_at, updated_at) DESC"),
  byTiktok: sql.prepare("SELECT id FROM kreo_creators WHERE tiktok = ? AND id <> ? AND sample = 0"),
  put: sql.prepare(`INSERT INTO kreo_creators (id, discord_name, discord_user, avatar, tiktok, niche, country, consent, status, source_guild, source_guild_name, guilds, metrics, level, sample, invited_at, invited_by, joined_at, updated_at)
    VALUES (:id, :discord_name, :discord_user, :avatar, :tiktok, :niche, :country, :consent, :status, :source_guild, :source_guild_name, :guilds, :metrics, :level, :sample, :invited_at, :invited_by, :joined_at, :updated_at)
    ON CONFLICT (id) DO UPDATE SET discord_name = excluded.discord_name, discord_user = excluded.discord_user, avatar = excluded.avatar, tiktok = excluded.tiktok, niche = excluded.niche,
      country = excluded.country, consent = excluded.consent, status = excluded.status, source_guild = excluded.source_guild, source_guild_name = excluded.source_guild_name,
      guilds = excluded.guilds, metrics = excluded.metrics, level = excluded.level, sample = excluded.sample, invited_at = excluded.invited_at, invited_by = excluded.invited_by,
      joined_at = excluded.joined_at, updated_at = excluded.updated_at`),
  del: sql.prepare("DELETE FROM kreo_creators WHERE id = ?"),
  delSamples: sql.prepare("DELETE FROM kreo_creators WHERE sample = 1"),
};

const fail = (status, message, code = "bad_request", field) => Object.assign(new Error(message), { status, code, ...(field ? { field } : {}) });
const now = () => new Date().toISOString();
const ID_RE = /^\d{17,20}$/;

const read = (r) => r && {
  id: r.id, discordName: r.discord_name, discordUser: r.discord_user, avatar: r.avatar,
  tiktok: r.tiktok, niche: r.niche, country: r.country, consent: Boolean(r.consent), status: r.status,
  sourceGuild: r.source_guild, sourceGuildName: r.source_guild_name, guilds: JSON.parse(r.guilds || "[]"),
  metrics: r.metrics ? JSON.parse(r.metrics) : null, level: r.level, sample: Boolean(r.sample),
  invitedAt: r.invited_at, invitedBy: r.invited_by, joinedAt: r.joined_at, updatedAt: r.updated_at,
};
function save(c) {
  q.put.run({
    id: c.id, discord_name: c.discordName || "", discord_user: c.discordUser || "", avatar: c.avatar || null,
    tiktok: c.tiktok || null, niche: c.niche || null, country: c.country || null, consent: c.consent ? 1 : 0, status: c.status,
    source_guild: c.sourceGuild || null, source_guild_name: c.sourceGuildName || null, guilds: JSON.stringify(c.guilds || []),
    metrics: c.metrics ? JSON.stringify(c.metrics) : null, level: c.level ?? null, sample: c.sample ? 1 : 0,
    invited_at: c.invitedAt || null, invited_by: c.invitedBy || null, joined_at: c.joinedAt || null, updated_at: now(),
  });
  return read(q.get.get(c.id));
}
export const getCreator = (id) => read(q.get.get(id));

/** Their level: TikTok's (via the CRM) when known, else from their 30-day GMV. */
function levelFrom(m) {
  return !m?.found ? null : m.level ?? levelOf(m.platformGmv ?? m.gmv);
}

// Levels saved before the L0–L7 ladder: work them out again (only rows whose level changes are written).
for (const c of q.all.all().map(read)) {
  const lv = levelFrom(c.metrics);
  if (lv !== c.level) save({ ...c, level: lv });
}

/** A server name: from KREO’s live list, else asked from Discord once (cached). */
const names = new Map();
async function serverName(id) {
  if (!id) return null;
  const live = kreoGuildName(id);
  if (live) return live;
  if (!names.has(id)) names.set(id, await kreo.call("GET", `/guilds/${id}`).then((g) => g.name || null).catch(() => null));
  return names.get(id);
}

/* ---------- signed join links ---------- */
const KEY = deriveKey("kreo-join-link");
const LINK_DAYS = 30;
const b64 = (x) => Buffer.from(x).toString("base64url");
const sign = (body) => createHmac("sha256", KEY).update(body).digest("base64url");

/** A link token for one Discord user, from one server. Valid for 30 days. */
export function joinToken(userId, guildId) {
  const body = b64(JSON.stringify({ u: userId, g: guildId || null, x: Math.floor(Date.now() / 1000) + LINK_DAYS * 86400 }));
  return body + "." + sign(body);
}
/** `{ userId, guildId }` for a valid token; throws a friendly error otherwise. */
export function readToken(token) {
  const [body, sig] = String(token || "").split(".");
  const bad = () => fail(404, "This join link isn’t valid. Message KREO “join” on Discord to get a new one.", "bad_link");
  if (!body || !sig || sig.length !== 43) throw bad();
  const want = Buffer.from(sign(body)), got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw bad();
  let t;
  try { t = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { throw bad(); }
  if (!ID_RE.test(t.u || "")) throw bad();
  if (!(t.x > Date.now() / 1000)) throw fail(410, "This join link has expired. Message KREO “join” on Discord to get a new one.", "expired_link");
  return { userId: t.u, guildId: ID_RE.test(t.g || "") ? t.g : null };
}

/** Where the app lives, for links in DMs: KREO_APP_URL, or the address the admin last used the app from. */
const APP_DOC = ["_platform", "settings/app"];
export function appUrl() {
  const env = String(process.env.KREO_APP_URL || "").trim().replace(/\/+$/, "");
  return env || store.get(...APP_DOC)?.url || null;
}
function rememberAppUrl(url) {
  if (typeof url !== "string" || !/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(url)) return;
  if (store.get(...APP_DOC)?.url !== url) store.set(...APP_DOC, { url, at: now() });
}
export const joinUrl = (userId, guildId, base = appUrl()) => (base ? `${base}/#join/${joinToken(userId, guildId)}` : null);

/* ---------- numbers from the CRM ---------- */
const handleOf = (s) => String(s || "").trim().replace(/^@+/, "").replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/i, "").replace(/[/?#].*$/, "").toLowerCase();

/**
 * GMV, sales, videos and views over the last 30 days for a TikTok handle, from the CRMs of the brands
 * whose servers this creator is in (KREO's database only knows what those brands' shops saw).
 */
export async function metricsFor(c) {
  const handle = handleOf(c.tiktok);
  if (!handle) return null;
  const guilds = new Set([c.sourceGuild, ...(c.guilds || [])].filter(Boolean));
  const brands = store.workspaces().filter(({ ws }) => ws.guildId && guilds.has(ws.guildId));
  const date_from = ymd(addDays(todayUTC(), -30)), date_to = ymd(addDays(todayUTC(), -1));
  const out = { gmv: 0, sales: 0, videos: 0, views: 0, found: false, sources: [], from: date_from, to: date_to, at: now(), checked: brands.length };
  for (const { ns } of brands) {
    const crm = crmFor(ns);
    let shops = [];
    try { shops = await crm.listShops(); } catch { continue; }
    for (const shop of shops) {
      let rows = [];
      try { rows = await crm.listCreators({ shop_id: shop.id, date_from, date_to }); } catch { continue; }
      const hit = rows.find((r) => String(r.handle).toLowerCase() === handle);
      if (!hit) continue;
      out.found = true;
      out.gmv = Math.round((out.gmv + (hit.gmv || 0)) * 100) / 100;
      out.sales += hit.sales || 0;
      out.videos += hit.videos || 0;
      out.views += hit.views || 0;
      out.sources.push(store.owner(ns)?.brand || shop.name);
      out.likes = (out.likes || 0) + (hit.likes || 0);
      out.comments = (out.comments || 0) + (hit.comments || 0);
      out.units = (out.units || 0) + (hit.units || 0);
      out.commission = Math.round(((out.commission || 0) + (hit.commission || 0)) * 100) / 100;
      takeProfile(out, hit);
    }
  }
  // Level, followers and platform-wide GMV describe the creator, not a shop: when the brands they came
  // from don't know them, look them up in other brands' live CRMs (profile only, never those shops' sales).
  if (out.level == null && out.followers == null) {
    const seen = new Set(brands.map((b) => b.ns));
    const others = store.workspaces().filter(({ ns }) => !seen.has(ns) && crmSource(ns) === "cruva").slice(0, 10);
    for (const { ns } of others) {
      const crm = crmFor(ns);
      let shops = [];
      try { shops = await crm.listShops(); } catch { continue; }
      for (const shop of shops) {
        let rows = [];
        try { rows = await crm.listCreators({ shop_id: shop.id, date_from, date_to }); } catch { continue; }
        const hit = rows.find((r) => String(r.handle).toLowerCase() === handle);
        if (hit) { takeProfile(out, hit); out.found = true; out.profileOnly = !out.sources.length; }
      }
      if (out.level != null || out.followers != null) break;
    }
  }
  return out;
}

/** Creator-level fields (not a shop's sales) from a CRM row. */
function takeProfile(out, hit) {
  if (hit.platformGmv != null) out.platformGmv = Math.max(out.platformGmv ?? 0, hit.platformGmv);
  if (hit.followers != null) out.followers = Math.max(out.followers ?? 0, hit.followers);
  if (hit.categories?.length) out.categories = [...new Set([...(out.categories || []), ...hit.categories])].slice(0, 6);
  if (hit.language) out.language = hit.language;
  if (hit.engagement != null) out.engagement = hit.engagement;
  const lv = normalizeLevel(hit.level, hit.platformGmv);
  if (lv != null) out.level = Math.max(out.level ?? 0, lv);
}
async function refresh(c) {
  const metrics = await Promise.race([metricsFor(c), new Promise((r) => setTimeout(() => r(undefined), 15_000))]).catch(() => undefined);
  if (metrics === undefined) return c; // the CRM was slow or down: keep what we had
  return save({ ...c, metrics, level: levelFrom(metrics) });
}

/* ---------- the join page (public: the signed link is the identity) ---------- */
const tries = new Map(); // userId → recent save times
function slowDown(userId) {
  const t = (tries.get(userId) || []).filter((x) => Date.now() - x < 10 * 60_000);
  if (t.length >= 15) throw fail(429, "That’s a lot of changes. Wait a few minutes and try again.", "rate_limited");
  t.push(Date.now());
  tries.set(userId, t);
}

async function discordUser(userId) {
  try { return await kreo.call("GET", `/users/${userId}`); } catch { return null; }
}

function publicView(c, guildId) {
  return {
    creator: { name: c?.discordName || "", user: c?.discordUser || "", avatar: c?.avatar || null },
    server: c?.sourceGuildName || null,
    profile: c && c.status === "joined" ? { tiktok: c.tiktok, niche: c.niche, country: c.country, consent: c.consent, joinedAt: c.joinedAt } : null,
    left: c?.status === "left",
    niches: NICHES, countries: COUNTRIES,
  };
}

async function joinGet(token) {
  const { userId, guildId } = readToken(token);
  let c = getCreator(userId);
  if (!c || !c.discordName) {
    const u = await discordUser(userId);
    if (u) c = { ...(c || { id: userId, status: "invited", sourceGuild: guildId, sourceGuildName: await serverName(guildId), guilds: guildId ? [guildId] : [] }), discordName: nameOf(u), discordUser: u.username, avatar: avatarOf(u) };
  }
  if (c && !c.sourceGuildName && guildId) c = { ...c, sourceGuildName: await serverName(guildId) };
  return publicView(c, guildId);
}

async function joinPost(token, body) {
  const { userId, guildId } = readToken(token);
  slowDown(userId);
  const prev = getCreator(userId);
  const base = prev || { id: userId, status: "invited", sourceGuild: guildId, sourceGuildName: await serverName(guildId), guilds: guildId ? [guildId] : [] };
  if (!base.discordName) {
    const u = await discordUser(userId);
    if (u) Object.assign(base, { discordName: nameOf(u), discordUser: u.username, avatar: avatarOf(u) });
  }
  if (guildId && !base.guilds.includes(guildId)) base.guilds = [...base.guilds, guildId];

  if (body?.leave === true) {
    const c = save({ ...base, consent: false, status: "left" });
    dmCreator(c, "You’ve left KREO", "Brands can no longer find you through KREO. Changed your mind? Open your join link again, or message me “join”.");
    return { ok: true, ...publicView(c, guildId) };
  }

  const tiktok = handleOf(body?.tiktok);
  if (!/^[a-z0-9._]{2,24}$/.test(tiktok)) throw fail(400, "Enter your TikTok username, like @yourname (letters, numbers, dots and underscores).", "bad_request", "tiktok");
  if (q.byTiktok.get(tiktok, userId)) throw fail(409, `@${tiktok} is already linked to another Discord account. If that’s yours, message KREO on Discord and we’ll sort it out.`, "taken", "tiktok");
  const niche = NICHES.includes(body?.niche) ? body.niche : null;
  if (!niche) throw fail(400, "Pick what you mostly post about.", "bad_request", "niche");
  const country = COUNTRIES.some(([code]) => code === body?.country) ? body.country : null;
  if (!country) throw fail(400, "Pick the country you sell in.", "bad_request", "country");
  if (body?.consent !== true) throw fail(400, "Tick the box so brands can find you. Without it we can’t add you.", "bad_request", "consent");

  const first = !prev || prev.status !== "joined";
  let c = save({ ...base, tiktok, niche, country, consent: true, status: "joined", joinedAt: first ? now() : prev.joinedAt });
  c = await refresh(c);
  if (first) dmCreator(c, "You’re in! 🎉", `Your TikTok **@${tiktok}** is linked to KREO. Brands looking for ${niche.toLowerCase()} creators can now find you and reach out here on Discord.\n\nWant to change something or leave? Open your join link again any time.`);
  return { ok: true, ...publicView(c, guildId) };
}

/* ---------- sending from KREO ---------- */
export async function dmCreator(c, title, text, button) {
  let channelId = null;
  try {
    channelId = (await kreo.call("POST", "/users/@me/channels", { recipient_id: c.id })).id;
    const msg = await kreo.call("POST", `/channels/${channelId}/messages`, {
      embeds: [{ title, description: text, color: KREO_COLOR }],
      ...(button ? { components: [{ type: 1, components: [{ type: 2, style: 5, label: button.label, url: button.url }] }] } : {}),
      allowed_mentions: { parse: [] },
    });
    recordKreo({ userId: c.id, name: c.discordName, channelId, guildId: c.sourceGuild, text, title, buttonUrl: button?.url || null, messageId: msg.id, sentBy: "KREO" });
    return { ok: true };
  } catch (e) {
    const error = e instanceof DiscordError ? why(e) : e.message;
    recordKreo({ userId: c.id, name: c.discordName, channelId, guildId: c.sourceGuild, text, title, buttonUrl: button?.url || null, status: "failed", error, sentBy: "KREO" });
    return { ok: false, error };
  }
}

const inviteText = (name, server) =>
  `Hi ${name || "there"} 👋\n\nKREO connects TikTok Shop creators with brands. Join to link your TikTok and let brands${server ? ` like the one behind **${server}**` : ""} find you for collabs, free samples and paid campaigns.\n\nIt takes 30 seconds, and you can leave any time.`;

const sent = new Map(); // admin email → send times
async function invite(user, body) {
  const guildId = String(body?.guildId || "").trim();
  const ids = [...new Set((Array.isArray(body?.userIds) ? body.userIds : []).map(String).filter((x) => ID_RE.test(x)))];
  if (!ID_RE.test(guildId)) throw fail(400, "Pick the server these people are in.", "bad_request", "guildId");
  if (!ids.length) throw fail(400, "Pick at least one person.", "bad_request", "userIds");
  if (ids.length > 25) throw fail(400, "Send to at most 25 people at a time.", "bad_request", "userIds");
  rememberAppUrl(body?.appUrl);
  const base = appUrl();
  if (!base) throw fail(400, "KREO doesn’t know the app’s address for the Join button. Set KREO_APP_URL on the backend.", "no_app_url");
  const mine = (sent.get(user.email) || []).filter((t) => Date.now() - t < 10 * 60_000);
  if (mine.length + ids.length > 60) throw fail(429, "That’s a lot of invites in 10 minutes. Wait a few minutes before sending more.", "rate_limited");

  const results = [];
  for (const userId of ids) {
    let member;
    try {
      member = await kreo.call("GET", `/guilds/${guildId}/members/${userId}`);
    } catch (e) {
      if (e instanceof DiscordError && [403].includes(e.status)) throw fail(400, "KREO isn’t in that server.", "not_in_guild", "guildId");
      results.push({ userId, ok: false, result: e instanceof DiscordError && (e.status === 404 || e.code === 10007) ? "Not in this server." : why(e) });
      continue;
    }
    if (member.user?.bot) { results.push({ userId, ok: false, result: "That’s a bot." }); continue; }
    const name = member.nick || nameOf(member.user);
    const prev = getCreator(userId);
    if (prev?.status === "joined") { results.push({ userId, name, ok: false, skipped: true, result: "Already joined." }); continue; }
    mine.push(Date.now());
    const server = await serverName(guildId);
    const c = save({
      ...(prev || { id: userId, guilds: [] }), status: prev?.status === "left" ? "left" : "invited",
      discordName: name, discordUser: member.user.username, avatar: avatarOf(member.user),
      sourceGuild: prev?.sourceGuild || guildId, sourceGuildName: prev?.sourceGuildName || server,
      guilds: [...new Set([...(prev?.guilds || []), guildId])], invitedAt: now(), invitedBy: user.email,
    });
    const r = await dmCreator(c, "Join KREO", inviteText(name, server), { label: "Join KREO", url: joinUrl(userId, guildId, base) });
    results.push({ userId, name, ok: r.ok, result: r.ok ? "Invite sent." : r.error });
  }
  sent.set(user.email, mine);
  const ok = results.filter((r) => r.ok).length;
  return { results, summary: `${ok} invite${ok === 1 ? "" : "s"} sent${results.length > ok ? `, ${results.length - ok} not sent` : ""}.` };
}

/* Someone writes "join" (or "link", "sign up") to KREO: send them their link. */
kreoDmHooks.push(async (d) => {
  if (!/\b(join|link|sign ?up|register)\b/i.test(d.content || "")) return;
  const c = getCreator(d.author.id);
  const url = joinUrl(d.author.id, c?.sourceGuild || null);
  if (!url) return;
  const person = c || { id: d.author.id, discordName: nameOf(d.author), sourceGuild: null };
  await dmCreator(person, c?.status === "joined" ? "Your KREO link" : "Join KREO",
    c?.status === "joined" ? "Here’s your link to update your details or leave KREO." : inviteText(nameOf(d.author), c?.sourceGuildName),
    { label: c?.status === "joined" ? "Open KREO" : "Join KREO", url });
});

/* ---------- settings ---------- */
const SETTINGS = ["_platform", "settings/kreo"];
export const kreoSettings = () => ({ autoInvite: true, ...(store.get(...SETTINGS) || {}) });

/* ---------- auto-invite: people who join a server KREO is in, from now on ---------- */
const autoQueue = [];
let autoBusy = false, autoHour = { at: 0, n: 0 };
const AUTO_PER_HOUR = 120, AUTO_SPACING = 3000; // gentle on Discord: no bursts of DMs

kreoMemberHooks.push((d) => {
  if (!kreoSettings().autoInvite || !d.user?.id || d.user.bot || !appUrl()) return;
  if (getCreator(d.user.id)) return; // already invited, joined or left: never pester them again
  autoQueue.push(d);
  if (!autoBusy) drainAuto();
});
async function drainAuto() {
  autoBusy = true;
  try {
    while (autoQueue.length) {
      if (Date.now() - autoHour.at > 3600_000) autoHour = { at: Date.now(), n: 0 };
      if (autoHour.n >= AUTO_PER_HOUR) { autoQueue.length = 0; break; } // a raid or a huge import: skip the rest
      const d = autoQueue.shift();
      if (getCreator(d.user.id)) continue;
      autoHour.n++;
      const server = await serverName(d.guild_id);
      const name = d.nick || nameOf(d.user);
      const c = save({ id: d.user.id, status: "invited", discordName: name, discordUser: d.user.username, avatar: avatarOf(d.user), sourceGuild: d.guild_id, sourceGuildName: server, guilds: [d.guild_id], invitedAt: now(), invitedBy: "auto" });
      await dmCreator(c, "Join KREO", inviteText(name, server), { label: "Join KREO", url: joinUrl(c.id, d.guild_id) });
      await new Promise((r) => setTimeout(r, AUTO_SPACING));
    }
  } finally {
    autoBusy = false;
  }
}

/* ---------- daily refresh of joined creators' numbers ---------- */
const DAY = 24 * 3600_000;
export async function refreshStale(limit = 25) {
  const stale = q.all.all().map(read).filter((c) => !c.sample && c.status === "joined" && c.tiktok && (!c.metrics?.at || Date.now() - Date.parse(c.metrics.at) > DAY)).slice(0, limit);
  for (const c of stale) await refresh(c);
  return stale.length;
}
export function startCreatorRefresh() {
  const run = () => refreshStale().catch((e) => console.error("[kreo refresh]", e.message));
  setTimeout(run, 60_000).unref();
  setInterval(run, 3600_000).unref();
}

/* ---------- sample creators (for testing search) ---------- */
const FIRST = ["Ava", "Mia", "Zoe", "Lily", "Emma", "Nora", "Ella", "Ruby", "Isla", "Leah", "Maya", "Sara", "Jade", "Amir", "Omar", "Leo", "Kai", "Noah", "Liam", "Eli", "Hana", "Aisha", "Sofia", "Lucas", "Dani"];
const WORDS = { "Health & wellness": ["wellness", "healthy", "vitamins", "glow"], "Beauty & skincare": ["beauty", "skin", "glam", "makeup"], Fashion: ["style", "fits", "closet", "ootd"], Fitness: ["fit", "gym", "lifts", "moves"], "Food & drink": ["eats", "kitchen", "snacks", "cooks"], "Home & kitchen": ["home", "finds", "nest", "decor"], "Tech & gadgets": ["tech", "gadgets", "unbox", "setup"], Pets: ["pets", "paws", "pup", "kitty"], "Baby & kids": ["mama", "baby", "littles", "momlife"], Lifestyle: ["daily", "life", "vlogs", "finds"] };
function* seeded(seed) { let s = seed >>> 0; for (;;) { s = (s * 1664525 + 1013904223) >>> 0; yield s / 2 ** 32; } }

export function loadSamples(n = 50) {
  q.delSamples.run();
  const r = seeded(20261127);
  const rnd = () => r.next().value;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const niches = Object.keys(WORDS);
  const countries = ["US", "US", "US", "GB", "GB", "CA", "AU", "DE", "PH", "MY"];
  const taken = new Set();
  for (let i = 0; i < n; i++) {
    const niche = niches[i % niches.length];
    const first = pick(FIRST);
    let tiktok;
    do tiktok = `sample.${first.toLowerCase()}${pick(["", ".", "_"])}${pick(WORDS[niche])}${Math.floor(rnd() * 90 + 10)}`; while (taken.has(tiktok));
    taken.add(tiktok);
    // A spread of levels: most creators small, a few large.
    const gmv = Math.round(Math.exp(rnd() * 14.6) * 100) / 100; // ~$1 to ~$2.2M: every level from L0 Bronze to L7 Diamond
    const sales = Math.max(1, Math.round(gmv / (15 + rnd() * 30)));
    const joined = new Date(Date.now() - Math.floor(rnd() * 60) * 864e5).toISOString();
    save({
      id: `sample-${String(i + 1).padStart(2, "0")}`, sample: true, status: "joined", consent: true,
      discordName: `${first} ${"ABCDEFGHJKLMNPRSTW"[i % 18]}. (sample)`, discordUser: tiktok.replace(/\./g, "_"), avatar: null,
      tiktok, niche, country: pick(countries), sourceGuild: null, sourceGuildName: "Sample data", guilds: [],
      metrics: (() => {
        const views = Math.round(gmv * (20 + rnd() * 80));
        return { gmv, platformGmv: gmv, sales, units: Math.round(sales * (1 + rnd() * 0.3)), commission: Math.round(gmv * 0.12 * 100) / 100, videos: Math.round(2 + rnd() * 40), views, likes: Math.round(views * (0.02 + rnd() * 0.06)), comments: Math.round(views * 0.002), engagement: Math.round((2 + rnd() * 8) * 10) / 10, followers: Math.round(800 + rnd() * 400_000), language: pick(["english", "english", "spanish"]), categories: [niche], found: true, sources: ["Sample data"], at: joined };
      })(),
      level: levelOf(gmv), joinedAt: joined, invitedAt: joined,
    });
  }
  return n;
}

/* ---------- admin list ---------- */
function list({ q: text, niche, level, show = "all" }) {
  const t = String(text || "").trim().toLowerCase().replace(/^@/, "");
  const rows = q.all.all().map(read).filter((c) =>
    (show === "all" || (show === "sample" ? c.sample : !c.sample)) &&
    (!niche || c.niche === niche) &&
    (!level || String(c.level) === String(level)) &&
    (!t || [c.discordName, c.discordUser, c.tiktok, c.niche, c.sourceGuildName].some((x) => String(x || "").toLowerCase().includes(t))));
  const all = q.all.all().map(read);
  const count = (f) => all.filter(f).length;
  return {
    creators: rows.slice(0, 500),
    total: rows.length,
    counts: { joined: count((c) => !c.sample && c.status === "joined"), invited: count((c) => !c.sample && c.status === "invited"), left: count((c) => !c.sample && c.status === "left"), samples: count((c) => c.sample) },
    niches: NICHES, levels: LEVELS, appUrl: appUrl(),
  };
}

/* ---------- routes ---------- */
export async function joinRoute({ p, m, readJson }) {
  const token = decodeURIComponent(p.slice("/api/join/".length));
  if (m === "GET") return joinGet(token);
  if (m === "POST") return joinPost(token, await readJson());
  throw fail(404, "Not found.", "not_found");
}

export async function creatorsRoute({ p, m, user, readJson, url }) {
  if (!isPlatformAdmin(user)) throw fail(404, "Not found.", "not_found");
  if (p === "/api/kreo/creators" && m === "GET") {
    const s = url.searchParams;
    return list({ q: s.get("q"), niche: s.get("niche"), level: s.get("level"), show: s.get("show") || "all" });
  }
  if (p === "/api/kreo/invite" && m === "POST") {
    if (!kreo.configured()) throw fail(503, "The KREO bot token isn’t set.", "not_configured");
    return invite(user, await readJson());
  }
  if (p === "/api/kreo/settings" && m === "GET") return kreoSettings();
  if (p === "/api/kreo/settings" && m === "PUT") {
    const b = await readJson();
    store.set(...SETTINGS, { ...kreoSettings(), ...(typeof b.autoInvite === "boolean" ? { autoInvite: b.autoInvite } : {}), by: user.email, at: now() });
    return kreoSettings();
  }
  if (p === "/api/kreo/creators/samples" && m === "POST") return { added: loadSamples(), ...list({}) };
  if (p === "/api/kreo/creators/samples" && m === "DELETE") return { removed: Number(q.delSamples.run().changes), ...list({}) };
  const one = /^\/api\/kreo\/creators\/([\w-]{1,40})(\/refresh)?$/.exec(p);
  if (one) {
    const c = getCreator(one[1]);
    if (!c) throw fail(404, "That creator isn’t in the database.", "not_found");
    if (one[2] && m === "POST") {
      if (c.sample) throw fail(400, "Sample creators have made-up numbers.");
      return { creator: await refresh(c) };
    }
    if (!one[2] && m === "DELETE") { q.del.run(c.id); return { ok: true }; }
  }
  throw fail(404, "Not found.", "not_found");
}
