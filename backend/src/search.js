/*
 * KREO AI creator search, for brands: find creators who joined KREO (and agreed to be found), then reach out.
 *
 * What a brand sees about a creator is their creator profile only: Discord name, TikTok handle, niche,
 * country, TikTok level, followers, platform-wide 30-day GMV, engagement and categories. Never another
 * brand's shop numbers (those stay with that brand).
 *
 * Reaching out follows Discord's rule that a bot can only DM people who share a server with it:
 *   - the creator is in the brand's server → the brand's own bot DMs them (replies land in Onboarding & DMs);
 *   - otherwise → KREO DMs them "<brand> wants to work with you" with a button to join the brand's server.
 *     When they join, the brand's bot sends the brand's message again, and the conversation continues there.
 * Each workspace keeps outreach/<creatorId> (status: messaged · invited · joined · replied · failed).
 * Shortlists are shortlists/<id> documents the browser writes.
 *
 *   GET  /api/creator-search                  ?levels=1,2&niches=..&countries=US&minFollowers=&maxFollowers=&minGmv=&maxGmv=&text=&sort=&samples=0
 *   POST /api/creator-search/parse            { query } → { filters, source: "ai" | "rules" }
 *   GET  /api/creator-search/<id>             one creator's profile
 *   POST /api/creator-search/<id>/message     { text } → reach out (owners, admins, moderators)
 */
import { store, sql } from "./store.js";
import { discord, DiscordError } from "./discord.js";
import { ai } from "./ai.js";
import * as audit from "./audit.js";
import { LEVELS } from "./levels.js";
import { COUNTRIES, NICHES, dmCreator, getCreator } from "./creators.js";
import { kreo, kreoDmHooks } from "./kreo.js";

const fail = (status, message, code = "bad_request", field) => Object.assign(new Error(message), { status, code, ...(field ? { field } : {}) });
const now = () => new Date().toISOString();

/* ---------- the searchable creators ---------- */
const allRows = sql.prepare("SELECT id FROM kreo_creators WHERE status = 'joined' AND consent = 1");

/** A creator as brands see them. */
function profile(c, ns) {
  const m = c.metrics || {};
  const gid = store.get(ns, "workspace/main")?.guildId;
  const inServer = Boolean(gid && (store.get(ns, "members/" + gid)?.list || []).some((x) => x.id === c.id));
  return {
    id: c.id, name: c.discordName, user: c.discordUser, avatar: c.avatar, sample: c.sample,
    tiktok: c.tiktok, niche: c.niche, country: c.country, level: c.level,
    followers: m.followers ?? null, gmv30: m.platformGmv ?? null, engagement: m.engagement ?? null,
    categories: m.categories || [], language: m.language || "", joinedAt: c.joinedAt, updatedAt: m.at || null,
    inServer, outreach: store.get(ns, "outreach/" + c.id) || null,
  };
}

const num = (v) => (v === undefined || v === null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const listOf = (v) => (Array.isArray(v) ? v : String(v || "").split(",")).map((x) => String(x).trim()).filter(Boolean);

export function normalizeFilters(f = {}) {
  const levels = [...new Set(listOf(f.levels).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 7))].sort();
  const niches = listOf(f.niches).filter((n) => NICHES.includes(n));
  const countries = listOf(f.countries).filter((c) => COUNTRIES.some(([code]) => code === c));
  const pos = (v) => (num(v) > 0 ? num(v) : null);
  return {
    levels, niches, countries,
    minFollowers: pos(f.minFollowers), maxFollowers: pos(f.maxFollowers), minGmv: pos(f.minGmv), maxGmv: pos(f.maxGmv),
    text: String(f.text || "").trim().slice(0, 80), sort: ["gmv", "followers", "level", "newest"].includes(f.sort) ? f.sort : "gmv",
    samples: f.samples !== "0" && f.samples !== false,
  };
}

function search(ns, raw) {
  const f = normalizeFilters(raw);
  const t = f.text.toLowerCase().replace(/^@/, "");
  const between = (v, lo, hi) => (lo == null || (v ?? -1) >= lo) && (hi == null || (v ?? Infinity) <= hi);
  const rows = allRows.all().map((r) => getCreator(r.id)).filter(Boolean).map((c) => profile(c, ns)).filter((c) =>
    (f.samples || !c.sample) &&
    (!f.levels.length || f.levels.includes(c.level)) &&
    (!f.niches.length || f.niches.includes(c.niche)) &&
    (!f.countries.length || f.countries.includes(c.country)) &&
    between(c.followers, f.minFollowers, f.maxFollowers) && between(c.gmv30, f.minGmv, f.maxGmv) &&
    (!t || [c.tiktok, c.name, c.user, ...(c.categories || [])].some((x) => String(x || "").toLowerCase().includes(t))));
  const key = { gmv: (c) => c.gmv30 ?? -1, followers: (c) => c.followers ?? -1, level: (c) => c.level ?? -1, newest: (c) => Date.parse(c.joinedAt || 0) }[f.sort];
  // Real creators first, then samples, each by the chosen order.
  rows.sort((a, b) => (a.sample - b.sample) || key(b) - key(a));
  return { creators: rows.slice(0, 200), total: rows.length, filters: f, real: rows.filter((c) => !c.sample).length };
}

/* ---------- plain words → filters ---------- */
const NICHE_WORDS = [
  ["Health & wellness", /\b(health|wellness|supplements?|vitamins?|nutrition|gut|sleep|immune|herbal)\b/i],
  ["Beauty & skincare", /\b(beauty|skin ?care|skincare|makeup|cosmetics?|hair ?care|haircare|glow)\b/i],
  ["Fashion", /\b(fashion|clothing|clothes|outfits?|style|apparel|jewelry|jewellery)\b/i],
  ["Fitness", /\b(fitness|gym|workout|exercise|sports?|athletes?)\b/i],
  ["Food & drink", /\b(food|drinks?|snacks?|cooking|recipes?|beverages?|coffee)\b/i],
  ["Home & kitchen", /\b(home|kitchen|cleaning|decor|household)\b/i],
  ["Tech & gadgets", /\b(tech|gadgets?|electronics?|phones?|gaming)\b/i],
  ["Pets", /\b(pets?|dogs?|cats?|puppy|puppies)\b/i],
  ["Baby & kids", /\b(baby|babies|kids|moms?|mums?|parenting|toddlers?)\b/i],
  ["Lifestyle", /\b(lifestyle|vlogs?|daily life)\b/i],
];
const COUNTRY_WORDS = [["US", /\b(us|usa|u\.s\.?|america|american|united states)\b/i], ["GB", /\b(uk|u\.k\.|britain|british|england|united kingdom)\b/i], ["AE", /\b(uae|emirates|dubai)\b/i], ["SA", /\b(saudi|ksa)\b/i]];
const amount = (n, unit) => Number(String(n).replace(/,/g, "")) * (/^k$/i.test(unit || "") ? 1e3 : /^m$/i.test(unit || "") ? 1e6 : 1);

export function parseRules(query) {
  let q = ` ${String(query || "")} `;
  const levels = new Set();
  const take = (re, fn) => { q = q.replace(re, (...m) => { fn(...m); return " "; }); };
  take(/\b(?:l|lv|lvl|level)\s*([0-7])\s*(?:-|–|to)\s*(?:l|lv|lvl|level)?\s*([0-7])\b/gi, (_, a, b) => { for (let i = Math.min(+a, +b); i <= Math.max(+a, +b); i++) levels.add(i); });
  take(/\b(?:l|lv|lvl|level)\s*([0-7])\s*(?:\+|and up|or (?:higher|above))/gi, (_, a) => { for (let i = +a; i <= 7; i++) levels.add(i); });
  take(/\b(?:l|lv|lvl|level)\s*([0-7])\b/gi, (_, a) => levels.add(+a));
  for (const l of LEVELS) take(new RegExp(`\\b${l.badge}\\b`, "gi"), () => levels.add(l.level));

  const out = { levels: [...levels].sort(), niches: [], countries: [], minFollowers: 0, maxFollowers: 0, minGmv: 0, maxGmv: 0, text: "", sort: "gmv", summary: "" };
  const under = /under|below|less than|max(?:imum)?|up to|<|at most/i;
  take(/(over|above|more than|at least|min(?:imum)?|>|under|below|less than|max(?:imum)?|up to|at most|<)?\s*([\d][\d.,]*)\s*(k|m)?\s*\+?\s*(?:followers|fans|follows)\b/gi, (_, dir, n, unit) => {
    out[dir && under.test(dir) ? "maxFollowers" : "minFollowers"] = Math.round(amount(n, unit));
  });
  take(/(over|above|more than|at least|min(?:imum)?|>|under|below|less than|max(?:imum)?|up to|at most|<)?\s*\$\s*([\d][\d.,]*)\s*(k|m)?\s*\+?\s*(?:gmv|in sales|sales|a month|monthly|\/mo)?/gi, (_, dir, n, unit) => {
    out[dir && under.test(dir) ? "maxGmv" : "minGmv"] = Math.round(amount(n, unit));
  });
  take(/(over|above|more than|at least|under|below|less than)?\s*([\d][\d.,]*)\s*(k|m)?\s*\+?\s*gmv\b/gi, (_, dir, n, unit) => {
    out[dir && under.test(dir) ? "maxGmv" : "minGmv"] = Math.round(amount(n, unit));
  });
  for (const [name, re] of NICHE_WORDS) if (re.test(q)) { out.niches.push(name); q = q.replace(new RegExp(re.source, "gi"), " "); }
  for (const [code, re] of COUNTRY_WORDS) if (re.test(q)) { out.countries.push(code); q = q.replace(new RegExp(re.source, "gi"), " "); }
  for (const [code, name] of COUNTRIES) if (code !== "OTHER" && new RegExp(`\\b${name}\\b`, "i").test(q) && !out.countries.includes(code)) { out.countries.push(code); q = q.replace(new RegExp(`\\b${name}\\b`, "gi"), " "); }
  if (/\b(most followers|biggest audience)\b/i.test(q)) out.sort = "followers";
  if (/\b(newest|latest|new(ly)? joined|recent)\b/i.test(q)) out.sort = "newest";
  q = q.replace(/\b(most followers|biggest audience|newest|latest|new(ly)? joined|recent(ly)?)\b/gi, " ");
  const left = q.replace(/\b(creators?|influencers?|affiliates?|tiktokers?|find|show|me|with|and|or|in|from|the|a|an|for|who|are|that|of|level|levels|niche|based|selling|sell|people|any|all)\b/gi, " ").replace(/[^\w@.\s]/g, " ").replace(/\s+/g, " ").trim();
  out.text = /^[@\w.]{3,}$/.test(left) ? left : "";
  out.summary = describe(out);
  return out;
}

const money = (n) => "$" + (n >= 1e6 ? +(n / 1e6).toFixed(1) + "M" : n >= 1e3 ? +(n / 1e3).toFixed(1) + "k" : n);
const count = (n) => (n >= 1e6 ? +(n / 1e6).toFixed(1) + "M" : n >= 1e3 ? +(n / 1e3).toFixed(1) + "k" : String(n));
export function describe(f) {
  const lv = f.levels?.length ? (f.levels.length > 2 && f.levels.every((x, i, a) => !i || x === a[i - 1] + 1) ? `L${f.levels[0]}–L${f.levels.at(-1)}` : f.levels.map((l) => "L" + l).join("/")) + " " : "";
  const niche = f.niches?.length ? f.niches.map((n) => n.toLowerCase()).join(" or ") + " " : "";
  const where = f.countries?.length ? " in " + f.countries.map((c) => COUNTRIES.find(([x]) => x === c)?.[1] || c).join(" or ") : "";
  const bits = [
    f.minFollowers ? `${count(f.minFollowers)}+ followers` : "", f.maxFollowers ? `under ${count(f.maxFollowers)} followers` : "",
    f.minGmv ? `over ${money(f.minGmv)} GMV` : "", f.maxGmv ? `under ${money(f.maxGmv)} GMV` : "",
  ].filter(Boolean);
  const s = `${lv}${niche}creators${where}${bits.length ? " with " + bits.join(", ") : ""}${f.text ? ` matching “${f.text}”` : ""}`;
  return s[0].toUpperCase() + s.slice(1);
}

async function parse(query) {
  const q = String(query || "").trim();
  if (!q) throw fail(400, "Describe the creators you’re looking for.", "bad_request", "query");
  if (ai.configured()) {
    try {
      const out = await ai.creatorQuery({ query: q, niches: NICHES, countries: COUNTRIES, levels: LEVELS });
      if (out) return { filters: { ...normalizeFilters(out), summary: out.summary || describe(out) }, source: "ai" };
    } catch (e) {
      console.error("[creator search ai]", e.message);
    }
  }
  const out = parseRules(q);
  return { filters: { ...normalizeFilters(out), summary: out.summary }, source: "rules" };
}

/* ---------- reaching out ---------- */
const COOLDOWN = 3 * 24 * 3600_000; // one message per creator every 3 days, unless they answered
const PER_DAY = 40; // per workspace
const sentToday = new Map(); // ns → times

/** An invite link to the brand's server, made by the brand's bot (kept for 6 days). */
async function serverInvite(ns, gid) {
  const ws = store.get(ns, "workspace/main") || {};
  if (ws.kreoInvite?.code && Date.now() - Date.parse(ws.kreoInvite.at) < 6 * 24 * 3600_000) return `https://discord.gg/${ws.kreoInvite.code}`;
  const g = store.get(ns, "discord/" + gid);
  const chans = (g?.channels || []).filter((c) => c.type === 0 || c.type === undefined);
  const first = chans.find((c) => /welcome|general|start|rules/i.test(c.name)) || chans[0];
  if (!first) return null;
  try {
    const inv = await discord.call("POST", `/channels/${first.id}/invites`, { max_age: 7 * 24 * 3600, max_uses: 0, unique: false });
    store.set(ns, "workspace/main", { ...store.get(ns, "workspace/main"), kreoInvite: { code: inv.code, at: now() } });
    return `https://discord.gg/${inv.code}`;
  } catch (e) {
    console.error("[outreach] invite", e.message);
    return null;
  }
}

/** Put a brand-bot message into the creator's DM thread, so replies show up in Onboarding & DMs. */
function logBrandDm(ns, gid, c, text, channelId) {
  const path = "dms/" + c.id;
  const t = store.get(ns, path) || { guild: gid, userId: c.id, user: c.discordUser, name: c.discordName, status: "done", step: 99, answers: {}, tiktok: c.tiktok || "", wa: "", startedAt: now(), msgs: [], source: "search" };
  t.msgs = [...(t.msgs || []), { from: "bot", text, at: now() }].slice(-200);
  if (channelId) t.channelId = channelId;
  if (!t.tiktok && c.tiktok) t.tiktok = c.tiktok;
  t.updatedAt = now();
  store.set(ns, path, t);
}

function saveOutreach(ns, c, patch, event) {
  const path = "outreach/" + c.id;
  const cur = store.get(ns, path) || { creatorId: c.id, name: c.discordName, avatar: c.avatar, tiktok: c.tiktok, level: c.level, niche: c.niche, history: [], replies: [], createdAt: now() };
  const next = { ...cur, ...patch, updatedAt: now(), history: [...(cur.history || []), { at: now(), ...event }].slice(-50) };
  store.set(ns, path, next);
  return next;
}

async function message(ns, user, id, body) {
  const c = getCreator(id);
  if (!c || c.status !== "joined" || !c.consent) throw fail(404, "That creator isn’t available any more.", "not_found");
  if (c.sample) throw fail(400, "This is a sample creator (made up for testing), so there’s no one to message.", "sample");
  const text = String(body?.text || "").trim();
  if (text.length < 10) throw fail(400, "Write a short message first (what you’d like to work on together).", "bad_request", "text");
  if (text.length > 1500) throw fail(400, "Keep it under 1,500 characters.", "bad_request", "text");
  const prev = store.get(ns, "outreach/" + id);
  if (prev && !["replied", "failed"].includes(prev.status) && Date.now() - Date.parse(prev.at || 0) < COOLDOWN) {
    const days = Math.max(1, Math.round((Date.now() - Date.parse(prev.at)) / 864e5));
    throw fail(429, `You messaged ${c.discordName} ${days === 1 ? "in the last day" : days + " days ago"}. Give them a few days to reply before messaging again.`, "cooldown");
  }
  const mine = (sentToday.get(ns) || []).filter((t) => Date.now() - t < 24 * 3600_000);
  if (mine.length >= PER_DAY) throw fail(429, `That’s ${PER_DAY} creators today. Try again tomorrow, so creators don’t get spammed.`, "rate_limited");

  const ws = store.get(ns, "workspace/main") || {};
  const gid = ws.guildId;
  const brand = store.owner(ns)?.brand || user.brand;
  const server = (gid && store.get(ns, "discord/" + gid)?.guildName) || brand;
  const inServer = Boolean(gid && (store.get(ns, "members/" + gid)?.list || []).some((x) => x.id === id));
  mine.push(Date.now());
  sentToday.set(ns, mine);
  const by = user.name;
  const log = (summary) => audit.log(ns, audit.actorOf(user), { category: "creators", action: "creators.outreach", label: c.tiktok ? "@" + c.tiktok : c.discordName, summary });

  if (inServer && discord.configured()) {
    try {
      const sent = await discord.dm(id, text);
      logBrandDm(ns, gid, c, text, sent.channelId);
      const o = saveOutreach(ns, c, { status: "messaged", via: "brand", text, by, at: now(), error: null }, { what: `${by} messaged them from your bot` });
      log(`Messaged ${c.discordName} from the brand bot (found in KREO creator search)`);
      return { ok: true, outreach: o, result: `Sent from your bot to ${c.discordName}. Replies show up in Onboarding & DMs.` };
    } catch (e) {
      const error = e instanceof DiscordError && e.code === 50007 ? `${c.discordName} doesn’t accept DMs from server members.` : "Discord refused the message: " + e.message;
      const o = saveOutreach(ns, c, { status: "failed", via: "brand", text, by, at: now(), error }, { what: "Couldn’t deliver: " + error });
      return { ok: false, outreach: o, result: error };
    }
  }

  if (!kreo.configured()) throw fail(503, "This creator isn’t in your server, and the KREO bot isn’t set up to introduce you.", "kreo_off");
  const invite = gid ? await serverInvite(ns, gid) : null;
  const r = await dmCreator(c, `${brand} wants to work with you 🤝`,
    `${text}\n\n— ${by}, ${brand}\n\n${invite ? `Join **${server}** on Discord to reply and chat with their team.` : `Reply here and KREO will let ${brand} know.`}`,
    invite ? { label: `Join ${server}`.slice(0, 80), url: invite } : null);
  if (!r.ok) {
    const o = saveOutreach(ns, c, { status: "failed", via: "kreo", text, by, at: now(), error: r.error }, { what: "Couldn’t deliver: " + r.error });
    return { ok: false, outreach: o, result: r.error };
  }
  const o = saveOutreach(ns, c, { status: "invited", via: "kreo", text, by, at: now(), error: null, invite }, { what: `${by} reached out through KREO${invite ? " with an invite to your server" : ""}` });
  log(`Reached out to ${c.discordName} through KREO${invite ? ", with an invite to the server" : ""} (found in KREO creator search)`);
  return {
    ok: true, outreach: o,
    result: invite
      ? `KREO sent your message to ${c.discordName} with a button to join ${server}. When they join, your bot sends your message again and the chat continues in Onboarding & DMs.`
      : `KREO sent your message to ${c.discordName}. Your bot couldn’t make an invite link to your server (give it the “Create Invite” permission), so they can only reply to KREO for now.`,
  };
}

/* ---------- what happens next (called from the bots) ---------- */

/** A creator joined the brand's server after KREO introduced them: the brand's bot picks up the conversation. */
export async function outreachJoined(ns, g, row) {
  const o = store.get(ns, "outreach/" + row.id);
  if (!o || o.status !== "invited") return;
  const c = getCreator(row.id) || { id: row.id, discordName: row.name, discordUser: row.user, tiktok: o.tiktok };
  const text = `Hey ${String(c.discordName || row.name).split(" ")[0]}, thanks for joining **${g.guildName}**! 👋\n\n${o.text}\n\nJust reply here and the team will see it.`;
  let error = null;
  try {
    const sent = await discord.dm(row.id, text);
    logBrandDm(ns, g.guildId, c, text, sent.channelId);
  } catch (e) {
    error = e.message;
  }
  saveOutreach(ns, c, { status: "joined", joinedServerAt: now(), error }, { what: error ? "Joined your server (your bot couldn’t DM them: " + error + ")" : "Joined your server, and your bot sent your message again" });
}

/** A creator answered the brand's bot. */
export function outreachReplied(ns, userId, text) {
  const o = store.get(ns, "outreach/" + userId);
  if (!o || o.status === "replied") return;
  store.set(ns, "outreach/" + userId, { ...o, status: "replied", repliedAt: now(), replies: [...(o.replies || []), { at: now(), text: String(text).slice(0, 1000), to: "brand" }].slice(-20), updatedAt: now(), history: [...(o.history || []), { at: now(), what: "Replied to your bot" }] });
}

/* A creator answered KREO after a brand reached out through it: pass it to those brands. */
kreoDmHooks.push((d) => {
  const text = d.content || "";
  if (!text || /^\s*(join|link|sign ?up|register)\s*[.!?]*\s*$/i.test(text)) return;
  for (const { ns, doc: o } of store.everywhere("outreach/" + d.author.id)) {
    if (o.via !== "kreo" || !["invited", "replied"].includes(o.status) || Date.now() - Date.parse(o.at || 0) > 30 * 864e5) continue;
    store.set(ns, "outreach/" + d.author.id, { ...o, status: "replied", repliedAt: now(), replies: [...(o.replies || []), { at: now(), text: text.slice(0, 1000), to: "kreo" }].slice(-20), updatedAt: now(), history: [...(o.history || []), { at: now(), what: "Replied to KREO" }] });
  }
});

/* ---------- routes ---------- */
export async function searchRoute({ p, m, user, url, readJson }) {
  const ns = user.workspace;
  if (p === "/api/creator-search" && m === "GET") return search(ns, Object.fromEntries(url.searchParams));
  if (p === "/api/creator-search/parse" && m === "POST") return parse((await readJson()).query);
  const one = /^\/api\/creator-search\/([\w-]{1,40})(\/message)?$/.exec(p);
  if (one) {
    if (!one[2] && m === "GET") {
      const c = getCreator(one[1]);
      if (!c || c.status !== "joined" || !c.consent) throw fail(404, "That creator isn’t available any more.", "not_found");
      return { creator: profile(c, ns) };
    }
    if (one[2] && m === "POST") {
      if (user.role === "Viewer") throw fail(403, "Your role can’t message creators. Ask the workspace owner.", "forbidden");
      return message(ns, user, one[1], await readJson());
    }
  }
  throw fail(404, "Not found.", "not_found");
}
