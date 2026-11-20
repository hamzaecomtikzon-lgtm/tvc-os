/*
 * Sample follow-ups: a DM nudge to creators who received a free sample but haven't
 * posted a video for it yet (Cruva's "Content Pending" and "Overdue" states).
 *
 * Only creators linked to a Discord member (their TikTok handle saved by onboarding) can be
 * DMed. Every nudge is logged in `samplenudges/<guildId>` as `{ [applyId]: { n, at, ... } }`,
 * so each sample gets at most two nudges, and so we can tell how many nudged creators
 * went on to post (Cruva moves the request to "Posted").
 */
import { store } from "./store.js";
import { discord } from "./discord.js";
import { linkedMembers } from "./tiers.js";
import { ymd } from "./dates.js";

export const DEFAULT_TEXT = "Hey {first_name}! 👋 Your {product} sample arrived {days} days ago. Got a video planned? Reply here if you need ideas or anything else, we’re happy to help 🙌";
export const DEFAULT_TEXT2 = "Hey {first_name}, quick reminder about your {product} sample 📦 Your video was due {due_date}. Even a simple 20-second demo works. Reply here if you’re stuck and we’ll help!";
const DAY = 864e5;
const MAX_NUDGES = 100;
const KEEP_DAYS = 120;
const MAX_AGE = 45; // samples delivered longer ago than this are never nudged

export function normalize(s = {}) {
  const int = (v, d, lo, hi) => Math.min(hi, Math.max(lo, parseInt(v, 10) || d));
  const after = int(s.after, 5, 1, 30);
  return {
    after,
    second: s.second !== false,
    secondAfter: Math.max(after + 2, int(s.secondAfter, 12, 3, 60)),
    text: String(s.text || "").trim().slice(0, 1500) || DEFAULT_TEXT,
    text2: String(s.text2 || "").trim().slice(0, 1500) || DEFAULT_TEXT2,
  };
}

const daysSince = (ymdStr) => (ymdStr ? Math.floor((Date.now() - Date.parse(ymdStr + "T00:00:00Z")) / DAY) : -1);
const nice = (ymdStr) => (ymdStr ? new Date(ymdStr + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "soon");

/** Fill a nudge template for one creator. */
export function fill(text, c) {
  return String(text)
    .replace(/\{(first_name|name)\}/g, String(c.name || "there").trim().split(/\s+/)[0] || "there")
    .replace(/\{product\}/g, c.product || "your sample")
    .replace(/\{days\}/g, String(Math.max(0, c.days ?? 0)))
    .replace(/\{due_date\}/g, nice(c.dueDate));
}

/**
 * Who to nudge today, plus how earlier nudges did. Reads the CRM; changes nothing.
 * → `{ settings, pending, nudges: [{ applyId, userId, name, handle, product, days, dueDate, n }], unlinked, stats }`
 */
export async function plan(ns, g, rawSettings, { crm, shop }) {
  const s = normalize(rawSettings);
  const pending = await crm.listSamples({ shop_id: shop.id, statuses: ["Content Pending", "Overdue"] });
  const linked = new Map(linkedMembers(ns, g.guildId).map((m) => [m.handle, m]));
  const log = store.get(ns, "samplenudges/" + g.guildId) || {};

  const nudges = [];
  let unlinked = 0;
  for (const x of pending) {
    const days = daysSince(x.receivedAt);
    if (days < 0 || days > MAX_AGE) continue; // not delivered yet, or too long ago to bring up
    const prev = log[x.applyId];
    let n = 0;
    if (!prev && days >= s.after) n = 1;
    else if (prev?.n === 1 && s.second && days >= s.secondAfter && Date.now() - Date.parse(prev.at) >= 2 * DAY) n = 2;
    if (!n) continue;
    const m = linked.get(String(x.handle).toLowerCase());
    if (!m) { unlinked++; continue; }
    nudges.push({ applyId: x.applyId, userId: m.userId, name: m.name, handle: m.handle, product: x.product, days, dueDate: x.dueDate, requestedAt: x.requestedAt, n });
  }
  nudges.sort((a, b) => b.days - a.days);
  return { settings: s, pending: pending.length, nudges: nudges.slice(0, MAX_NUDGES), unlinked, stats: await results(ns, g, crm, shop, log) };
}

/** How many nudged samples were posted afterwards (last 30 days of nudges). Marks posted ones in the log. */
async function results(ns, g, crm, shop, log) {
  const since = Date.now() - 30 * DAY;
  const recent = Object.entries(log).filter(([, e]) => Date.parse(e.at) >= since);
  if (!recent.length) return { nudged: 0, posted: 0 };
  const open = recent.filter(([, e]) => !e.posted);
  if (open.length) {
    const from = open.map(([, e]) => e.requestedAt).filter(Boolean).sort()[0];
    try {
      const posted = new Set((await crm.listSamples({ shop_id: shop.id, statuses: ["Posted"], time_from: from })).map((x) => x.applyId));
      let changed = false;
      for (const [id, e] of open) if (posted.has(id)) { e.posted = ymd(new Date()); changed = true; }
      if (changed) store.set(ns, "samplenudges/" + g.guildId, log);
    } catch (e) {
      console.error("[samples] posted check", e.message);
    }
  }
  return { nudged: recent.length, posted: recent.filter(([, e]) => e.posted).length };
}

/**
 * Send the nudges. `templates` are the (possibly edited) first and second message texts.
 * Returns `{ sent, failed }`.
 */
export async function apply(ns, g, action, templates) {
  const log = store.get(ns, "samplenudges/" + g.guildId) || {};
  let sent = 0, failed = 0;
  for (const c of action.nudges) {
    const text = fill(templates[c.n === 2 ? 1 : 0] || (c.n === 2 ? DEFAULT_TEXT2 : DEFAULT_TEXT), c);
    try {
      const r = await discord.dm(c.userId, text);
      sent++;
      log[c.applyId] = { n: c.n, at: new Date().toISOString(), userId: c.userId, handle: c.handle, product: c.product, requestedAt: c.requestedAt || null, posted: log[c.applyId]?.posted || null };
      // Keep the inbox complete: the nudge shows in the creator's DM thread.
      const t = store.get(ns, "dms/" + c.userId);
      if (t) store.set(ns, "dms/" + c.userId, { ...t, channelId: r.channelId, msgs: [...(t.msgs || []), { from: "bot", text, at: new Date().toISOString(), by: "sample follow-up" }].slice(-200), updatedAt: new Date().toISOString() });
    } catch {
      failed++; // DMs closed; try again tomorrow
    }
  }
  const cutoff = Date.now() - KEEP_DAYS * DAY;
  for (const [id, e] of Object.entries(log)) if (Date.parse(e.at) < cutoff) delete log[id];
  store.set(ns, "samplenudges/" + g.guildId, log);
  return { sent, failed };
}

/** The draft for a plan: the message templates (editable in Approvals), a summary, and the action. */
export function draftFor(p) {
  const s = p.settings;
  const firsts = p.nudges.filter((c) => c.n === 1), seconds = p.nudges.filter((c) => c.n === 2);
  const messages = [], templates = [];
  if (firsts.length) { messages.push({ text: s.text }); templates.push("first"); }
  if (seconds.length) { messages.push({ text: s.text2 }); templates.push("second"); }
  const summary = p.nudges.map((c) => `${c.n === 2 ? "2nd" : "1st"} · ${c.name} (@${c.handle}): ${c.product}, delivered ${c.days} days ago`).join("\n");
  return {
    messages, summary,
    action: { type: "nudges", templates, nudges: p.nudges.map(({ applyId, userId, name, handle, product, days, dueDate, requestedAt, n }) => ({ applyId, userId, name, handle, product, days, dueDate, requestedAt, n })) },
  };
}
