/*
 * Deterministic demo data standing in for Cruva (TikTok Shop analytics) and the
 * Discord server. Everything is seeded, so numbers stay stable across reloads,
 * and dates are relative to today so the dashboard always looks current.
 */
import { hash, rng } from "./rng.js";
import { addDays, dateList, daysBetween, todayUTC, ymd } from "../lib/format.js";

export const HOME_GUILD = "1532483829300858920";
export const GUILD_NAME = "Pharmlitalia - Creator Community";
export const BOT_NAME = "hayfa - community lead";

export const SHOPS = [
  { name: "Pharmlitalia", id: "64f1c2a9e4b7d3a1", plan: "Growth", region: "us" },
  { name: "Pharmlitalia UK", id: "71a3e5c1b7f2d9c4", plan: "Starter", region: "uk" },
];
const SCALE = { [SHOPS[0].id]: 1, [SHOPS[1].id]: 0.32 };
const scaleOf = (id) => SCALE[id] ?? 0.5;
const r2 = (v) => Math.round(v * 100) / 100;

const FIRST = ["mia", "jade", "sofia", "ella", "nora", "ava", "luna", "zoe", "lily", "ruby", "grace", "chloe", "isla", "maya", "aria",
  "leah", "emma", "olivia", "amara", "priya", "hana", "tessa", "nina", "kira", "bella", "rosa", "ivy", "june", "skye", "dani"];
const LAST = ["R.", "M.", "K.", "B.", "S.", "T.", "L.", "C.", "D.", "P."];
const TAGS = ["beauty", "glow", "skin", "daily", "finds", "edits", "vibes", "ugc", "shop", "reviews", "wellness", "lab", "haul", "picks", "glam"];

/** TikTok creator handles that post affiliate videos. */
export const HANDLES = Array.from({ length: 48 }, (_, i) =>
  FIRST[i % 30] + (i % 3 === 1 ? "." : i % 3 === 2 ? "_" : "") + TAGS[(i * 7) % 15] + (i >= 30 ? String(i) : ""));

/* ---------- Discord server ---------- */
const chanId = (i) => "1532483" + String(830000000000 + i * 7177).padStart(12, "0");
export const CHANNELS = [
  ["welcome", "START HERE", true, 0], ["introductions", "START HERE", true, 1], ["announcements", "START HERE", true, 0],
  ["general-chat", "COMMUNITY", true, 6], ["🏆・share-wins", "COMMUNITY", true, 2], ["📊-leaderboard", "COMMUNITY", true, 0.2],
  ["🎬-viral-hooks-and-ideas", "CONTENT LAB", true, 1], ["🔥・winning-angles", "CONTENT LAB", true, 1], ["content-feedback", "CONTENT LAB", true, 2],
  ["sample-requests", "SUPPORT", true, 1.2], ["help-desk", "SUPPORT", false, 0.8], ["moderator-only", "STAFF", true, 0.4],
].map(([name, category, canPost, w], i) => ({ id: chanId(i), name, category, canPost, w }));

export const ROLES = ["Admin", "Moderator", "Brand Team", "Top Creator", "Creator", "New Member"];

export function guildDoc() {
  return {
    guildId: HOME_GUILD,
    guildName: GUILD_NAME,
    botName: BOT_NAME,
    channels: CHANNELS.map(({ id, name, category, canPost }) => ({ id, name, category, canPost })),
    roles: ROLES,
    syncedAt: new Date().toISOString(),
  };
}

/* ---------- members (shared between Cruva's Discord list and activity) ---------- */
export const MEMBERS = (() => {
  const r = rng(hash("members-v1"));
  const today = todayUTC();
  const out = [];
  for (let i = 0; i < 140; i++) {
    const first = FIRST[i % FIRST.length];
    const user = first + ["_", ".", ""][i % 3] + ["tiktok", "creates", "ugc", "sells", "x", "official"][Math.floor(r() * 6)] + (i >= FIRST.length ? i : "");
    const display = first[0].toUpperCase() + first.slice(1) + " " + LAST[Math.floor(r() * LAST.length)];
    const age = Math.floor(Math.pow(r(), 0.9) * 118);
    const joined = ymd(addDays(today, -age));
    const inPool = i < HANDLES.length;
    const linked = inPool ? r() < 0.8 : r() < 0.4;
    const tiktok = linked ? (inPool ? HANDLES[i] : user.replace(/[^a-z0-9._]/g, "")) : "";
    const e = i < 4 ? 0.85 : Math.pow(r(), 1.6);
    const roles = i < 2 ? ["Moderator"] : i === 2 ? ["Admin"] : i === 3 ? ["Brand Team"] : [r() < 0.15 ? "Top Creator" : "Creator"];
    if (age < 7) roles.push("New Member");
    out.push({ id: "118" + String(i * 104729 + 1000003).padStart(16, "0"), user, display, tiktok, linked, roles, joined, e });
  }
  return out;
})();

/* ---------- shop stats ---------- */
export function dayStats(shopId, date) {
  const r = rng(hash(shopId + date));
  const s = scaleOf(shopId);
  const idx = daysBetween("2026-01-01", date);
  const season = 1 + 0.18 * Math.sin(idx / 4.3) + 0.08 * Math.sin(idx / 1.7);
  const trend = 1 + idx * 0.0016;
  const dow = new Date(date + "T00:00:00Z").getUTCDay();
  const wk = dow === 0 || dow === 6 ? 1.12 : 1;
  const total = 4200 * s * season * trend * wk * (0.8 + r() * 0.4);
  const affiliate = total * (0.55 + r() * 0.15);
  const ads = affiliate * (0.3 + r() * 0.18);
  const rs = Math.sqrt(s);
  const req = Math.round((6 + r() * 18) * rs);
  const appr = Math.round(req * (0.6 + r() * 0.25));
  return {
    total_gmv: r2(total),
    affiliate_gmv: r2(affiliate),
    ads_gmv: r2(ads),
    organic_gmv: r2(affiliate - ads),
    commission: r2(affiliate * 0.15),
    daily_active_affiliates: Math.round((18 + r() * 22) * rs * season),
    videos_posted: Math.round((14 + r() * 26) * rs),
    video_views: Math.round((60000 + r() * 140000) * s * season),
    sample_requests: req,
    samples_approved: appr,
    samples_delivered: Math.round(appr * (0.7 + r() * 0.25)),
    dms_sent: Math.round((90 + r() * 220) * rs),
  };
}

export const STAT_LABELS = {
  total_gmv: "Total GMV", affiliate_gmv: "Affiliate GMV", ads_gmv: "Ads GMV", organic_gmv: "Organic GMV",
  commission: "Commission", daily_active_affiliates: "Creators with sales", videos_posted: "Videos posted",
  video_views: "Video views", sample_requests: "Sample requests", samples_approved: "Samples approved",
  samples_delivered: "Samples delivered", dms_sent: "Outreach DMs",
};

/** Sum a stat over a range (unique creators are approximated, not summed). */
export function rangeStat(shopId, key, from, to) {
  const days = dateList(from, to);
  const vals = days.map((d) => dayStats(shopId, d)[key]);
  if (key === "daily_active_affiliates") return Math.round(Math.max(0, ...vals) * (1 + 0.35 * Math.log(days.length)));
  return r2(vals.reduce((a, b) => a + b, 0));
}

/* ---------- videos ---------- */
const PRODUCTS = [
  ["Collagen Glow Serum", "a glass-skin routine with the collagen serum"],
  ["Vitamin C Brightening Drops", "a morning vitamin C routine with a before/after"],
  ["Biotin Hair Gummies", "a 30-day hair growth check-in"],
  ["Magnesium Sleep Spray", "a wind-down night routine for better sleep"],
  ["SPF 50 Invisible Fluid", "a no-white-cast SPF test on camera"],
  ["Retinol Night Cream", "retinol for beginners, week 1 vs week 6"],
  ["Hyaluronic Lip Plumper", "a first-try lip plumper reaction"],
  ["Probiotic Gut Capsules", "a two-week bloating diary"],
];
const HOOKS = [
  ["Stop scrolling if your skin looks dull by 3pm", "Calls out a specific, relatable pain in the first second."],
  ["I was today years old when I found out…", "Curiosity gap that makes viewers wait for the reveal."],
  ["POV: your dermatologist finally gives you the answer", "POV framing puts the viewer inside the story."],
  ["I tried this every day for 30 days", "Time-bound challenge promises a payoff."],
  ["3 reasons I keep repurchasing this", "Numbered list sets clear expectations."],
  ["This is your sign to fix your night routine", "Direct permission hook, works well with routine content."],
  ["Don’t buy this until you watch this", "Reverse-psychology warning drives watch time."],
  ["The $20 find nobody is talking about", "Price anchor plus exclusivity."],
];
const LIFE = Array.from({ length: 21 }, (_, k) => Math.exp(-k / 5));
const LIFE_SUM = LIFE.reduce((a, b) => a + b, 0);

const poolCache = {};
export function videoPool(shopId) {
  if (poolCache[shopId]) return poolCache[shopId];
  const r = rng(hash("videos" + shopId));
  const s = scaleOf(shopId);
  const today = todayUTC();
  const vids = [];
  for (let i = 0; i < 240; i++) {
    const age = Math.floor(Math.pow(r(), 1.3) * 130);
    const handle = HANDLES[Math.floor(Math.pow(r(), 1.8) * HANDLES.length)];
    const [product, desc] = PRODUCTS[Math.floor(r() * PRODUCTS.length)];
    const h1 = Math.floor(r() * HOOKS.length);
    const h2 = (h1 + 1 + Math.floor(r() * (HOOKS.length - 1))) % HOOKS.length;
    const gmv = Math.exp(3 + r() * 4.6) * s;
    const hasAds = r() < 0.55;
    const adsShare = hasAds ? 0.2 + r() * 0.5 : 0;
    vids.push({
      video_id: "7" + String(hash(shopId + i)).padStart(10, "0") + String(i).padStart(4, "0"),
      handle,
      title: `${product} · ${HOOKS[h1][0]}`,
      content_overview: `@${handle} films ${desc}, opens on a tight close-up and pins the TikTok Shop link in the first comment.`,
      post_date: ymd(addDays(today, -age)),
      hooks: [
        { hook: HOOKS[h1][0], explanation: HOOKS[h1][1], score: 6 + Math.floor(r() * 4) },
        { hook: HOOKS[h2][0], explanation: HOOKS[h2][1], score: 5 + Math.floor(r() * 4) },
      ],
      video_link: `https://www.tiktok.com/@${handle}/video/7${String(hash("v" + shopId + i)).padStart(18, "0")}`,
      base: {
        gmv, views: gmv * (40 + r() * 160), price: 18 + r() * 22, hasAds, adsShare,
        unknown: r() < 0.08, spend: hasAds ? (gmv * adsShare) / (0.6 + r() * 2.4) : 0,
      },
    });
  }
  return (poolCache[shopId] = vids);
}

/** Fraction of a video's sales life (21 days, decaying) that falls inside a range. */
export function lifeFraction(post, from, to) {
  let w = 0;
  for (let k = 0; k < LIFE.length; k++) {
    const d = ymd(addDays(post, k));
    if (d >= from && d <= to) w += LIFE[k];
  }
  return w / LIFE_SUM;
}

/* ---------- Discord activity (written to the store by the worker on sync) ---------- */
export function genActivity(guildId) {
  const r = rng(hash("activity" + guildId));
  const today = todayUTC();
  const chatty = CHANNELS.filter((c) => c.w > 0);
  const wsum = chatty.reduce((a, c) => a + c.w, 0);
  const pick = () => {
    let x = r() * wsum;
    for (const c of chatty) if ((x -= c.w) <= 0) return c;
    return chatty[0];
  };
  const docs = [];
  for (let back = 119; back >= 0; back--) {
    const date = ymd(addDays(today, -back));
    const dow = new Date(date + "T00:00:00Z").getUTCDay();
    const users = {};
    const channels = {};
    const replyTimes = [];
    for (const m of MEMBERS) {
      if (m.joined > date) continue;
      const age = daysBetween(m.joined, date);
      const fresh = age < 7 ? 1.5 : 1;
      const fade = m.e < 0.2 && age > 21 ? 0.3 : 1;
      const p = Math.min(0.92, (0.04 + m.e * 0.6) * fresh * fade * (dow === 0 || dow === 6 ? 0.8 : 1));
      if (r() > p) continue;
      const msgs = Math.round(r() * r() * m.e * 40 + (r() < 0.7 ? 1 : 0));
      const u = { n: m.display, m: msgs, rr: 0, pr: 0, rg: 0, v: 0, roles: m.roles };
      for (let k = 0; k < msgs; k++) {
        const c = pick();
        const ch = channels[c.id] || (channels[c.id] = { name: c.name, m: 0, r: 0, p: 0, top: {} });
        const react = r() < 0.45 ? 1 + Math.floor(r() * 3) : 0;
        const reply = r() < 0.28 ? 1 : 0;
        ch.m++; ch.r += react; ch.p += reply;
        ch.top[m.id] = (ch.top[m.id] || 0) + 1;
        u.rr += react; u.pr += reply;
        if (reply) replyTimes.push(Math.round(30 * Math.exp(r() * 6.2)));
      }
      u.rg = msgs ? Math.floor(r() * 6 * m.e) : 1 + Math.floor(r() * 4);
      u.v = r() < 0.06 ? 5 + Math.floor(r() * 90) : 0;
      users[m.id] = u;
    }
    docs.push({ path: `activity/${guildId}_${date}`, data: { guild: guildId, date, users, channels, replyTimes } });
  }
  return docs;
}

export function seedResponses(guildId) {
  const r = rng(hash("responses" + guildId));
  const niches = ["skincare routines", "GRWM and makeup", "wellness and supplements", "honest reviews", "hauls and unboxings"];
  const exp = ["Yes, about $2k last month", "Just started, under $100", "Not yet!", "Yes, around $500 a month", "A little, maybe $300 total"];
  const help = ["samples", "content ideas", "commission boosts", "content ideas and samples"];
  const qs = [
    "What’s your TikTok handle?",
    "What kind of content do you mostly make?",
    "Have you sold on TikTok Shop before? Roughly how much?",
    "What would help you most here: samples, content ideas or commission boosts?",
  ];
  return MEMBERS.filter((m) => m.roles.includes("New Member") || daysBetween(m.joined, ymd(todayUTC())) < 14)
    .slice(0, 8)
    .map((m) => {
      const done = r() < 0.7;
      return {
        path: `onboarding_responses/${guildId}_${m.id}`,
        data: {
          guild: guildId, discord: "@" + m.user, joined: m.joined, tiktok: m.linked ? m.tiktok : "",
          answers: done
            ? { [qs[0]]: m.tiktok ? "@" + m.tiktok : "@" + m.user, [qs[1]]: niches[Math.floor(r() * niches.length)], [qs[2]]: exp[Math.floor(r() * exp.length)], [qs[3]]: help[Math.floor(r() * help.length)] }
            : { [qs[0]]: m.tiktok ? "@" + m.tiktok : "" },
          status: done ? "Completed" : "Reminder sent",
        },
      };
    });
}
