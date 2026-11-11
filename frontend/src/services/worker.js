/*
 * Demo stand-in for the Claude session that runs the bot. It watches the
 * `requests` collection and performs each request against the store, the way
 * the real session would against Discord + Cruva.
 */
import { db } from "./db.js";
import { CHANNELS, HOME_GUILD, MEMBERS, SHOPS, genActivity, guildDoc, lifeFraction, seedResponses, videoPool } from "./mockData.js";
import { addDays, todayUTC, ymd } from "../lib/format.js";
import { AUTOS } from "../lib/constants.js";

const busy = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

export function startWorker() {
  const tick = () => {
    for (const r of db.list("requests", (x) => x.status === "sent" || x.status === "queued")) {
      if (busy.has(r.id)) continue;
      busy.add(r.id);
      setTimeout(() => run(r).finally(() => busy.delete(r.id)), 700);
    }
  };
  db.subscribe(tick);
  tick();
}

async function run(r) {
  const path = "requests/" + r.id;
  try {
    await db.update(path, { status: "working" });
    await HANDLERS[r.type]?.(r);
    if (db.get(path)) await db.update(path, { status: "done", doneAt: now() });
  } catch (e) {
    if (db.get(path)) await db.update(path, { status: "failed", error: String(e?.message || e) });
  }
}

const HANDLERS = {
  async sync() {
    await sleep(600);
    const entries = [{ path: "discord/" + HOME_GUILD, data: guildDoc() }];
    if (!db.count("activity")) entries.push(...genActivity(HOME_GUILD));
    if (!db.count("onboarding_responses")) entries.push(...seedResponses(HOME_GUILD));
    await db.setMany(entries);
  },

  async allowlist(r) {
    await sleep(900);
    const p = "allowlist/" + (r.guild || HOME_GUILD);
    if (db.get(p)) await db.update(p, { syncedAt: now() });
  },

  async draft(r) {
    await sleep(1800);
    const guild = r.guild || HOME_GUILD;
    const g = db.get("discord/" + guild);
    const cfg = db.get("config/" + guild) || {};
    const autos = db.get("automations/" + guild)?.items || {};
    const ws = db.get("workspace/main") || {};
    const shop = SHOPS.find((s) => s.id === ws.shopId) || SHOPS[0];
    const auto = AUTOS.find((a) => a.key === r.automation);
    const s = autos[r.automation] || auto.defaults;
    const mod = cfg.modChannel || g?.channels.find((c) => c.name === "moderator-only")?.id || "";
    const target = r.test ? mod : s.channel;
    const messages = BUILD[r.automation](shop, s);
    await db.add("drafts", {
      guild, automation: r.automation, name: auto.name,
      channel: target, channelName: g?.channels.find((c) => c.id === target)?.name || "",
      test: !!r.test, source: r.test ? "test" : "schedule", replaces: r.replaces || null,
      messages, text: messages.map((m) => m.text).join("\n\n"),
      status: "pending", createdAt: now(), history: [{ at: now(), what: "Built by Claude" }],
    });
  },

  async post(r) {
    await sleep(1200);
    const p = "drafts/" + r.draftId;
    const d = db.get(p);
    if (!d) return;
    const ch = CHANNELS.find((c) => c.id === d.channel);
    if (ch && ch.canPost === false) {
      await db.update(p, { status: "pending", error: `The bot can’t post in #${ch.name}.`, history: [...(d.history || []), { at: now(), what: "Post failed" }] });
      return;
    }
    const msgId = String(BigInt(Date.now()) * 4194304n);
    await db.update(p, {
      status: "posted", error: null,
      messageUrl: `https://discord.com/channels/${d.guild}/${d.channel}/${msgId}`,
      history: [...(d.history || []), { at: now(), what: `Posted to #${d.channelName || "channel"}` }],
    });
  },

  async reject() {
    await sleep(300);
  },
};

/* ---------- draft builders: mirror each automation's skill output ---------- */
function topVideos(shop, days, n) {
  const to = ymd(addDays(todayUTC(), -1));
  const from = ymd(addDays(todayUTC(), -days));
  const sym = shop.region === "uk" ? "£" : "$";
  return videoPool(shop.id)
    .map((v) => ({ ...v, f: lifeFraction(v.post_date, from, to) }))
    .filter((v) => v.f > 0)
    .map((v) => ({ ...v, gmv: v.base.gmv * v.f, views: v.base.views * v.f }))
    .sort((a, b) => b.gmv - a.gmv)
    .slice(0, n)
    .map((v) => ({ ...v, money: sym + Math.round(v.gmv).toLocaleString() }));
}
const memberFor = (handle) => MEMBERS.find((m) => m.tiktok === handle && m.linked);
const tag = (handle, on) => {
  const m = memberFor(handle);
  return on && m ? `<@${m.id}>` : "@" + handle;
};
const k = (v) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "k" : String(Math.round(v)));

const BUILD = {
  viral_hooks(shop, s) {
    const vids = topVideos(shop, s.lookback || 7, 3);
    const medal = ["1.", "2.", "3."];
    return [{
      text: [
        "# 🔥 viral hooks of the week",
        `-# top 3 videos in the market · last ${s.lookback || 7} days`,
        "",
        ...vids.flatMap((v, i) => [
          `**${medal[i]} “${v.hooks[0].hook}”** by @${v.handle}`,
          `${k(v.views)} views · ${v.money} GMV`,
          `how to remake it: ${v.hooks[0].explanation.toLowerCase()} open the same way, swap in your own product shot in the first 2 seconds.`,
          v.video_link,
          "",
        ]),
        s.everyone ? "@here go film one today 🎬" : "go film one today 🎬",
      ].join("\n"),
    }];
  },

  winning_content(shop, s) {
    const [v] = topVideos(shop, 7, 1);
    if (!v) return [{ text: "no winning video last week. we’ll be back next monday 💪" }];
    const who = tag(v.handle, s.tagCreator);
    const parts = s.parts || [];
    const msgs = [];
    if (parts.includes("Video post"))
      msgs.push({ text: `# 🏆 winning angle of the week\n-# last week’s #1 video by GMV\n\nhuge shoutout to ${who} for this one YAYYY\n${v.video_link}${s.everyone ? "\n\n@here" : ""}` });
    if (parts.includes("Numbers card"))
      msgs.push({ text: `**the numbers**\n💰 ${v.money} GMV\n👀 ${k(v.views)} views\n🛒 ${Math.round(v.gmv / v.base.price)} units sold` });
    if (parts.includes("Script card"))
      msgs.push({ text: `**the script**\nhook: “${v.hooks[0].hook}”\nmiddle: show the product in hand, one honest result, one texture shot\nclose: “link’s in the orange cart, grab it before the sale ends”` });
    if (parts.includes("How to replicate"))
      msgs.push({ text: `**how to replicate**\n1. film the hook in one take, face to camera\n2. ${v.hooks[0].explanation.toLowerCase()}\n3. keep it under 25 seconds\n4. pin the shop link in the first comment\nlessgoooo 🚀` });
    return msgs.length ? msgs : [{ text: "nothing selected to include. turn on at least one part in settings." }];
  },

  wins(shop, s) {
    const levels = String(s.thresholds || "1, 3, 10, 30, 50").split(",").map((x) => parseInt(x, 10)).filter(Boolean);
    const linked = MEMBERS.filter((m) => m.linked).slice(4, 7);
    return linked.map((m, i) => {
      const n = levels[Math.min(i + 1, levels.length - 1)] || 1;
      const who = s.tagCreator ? `<@${m.id}>` : s.handleFallback ? "@" + m.tiktok : m.display;
      return {
        text: `YAYYY ${who} just hit their **${ordinal(n)} sale** on TikTok Shop 🎉 lessgoooo`,
        images: s.graphic ? [milestoneCard(n, m.tiktok)] : [],
      };
    });
  },

  leaderboard(shop, s) {
    const vids = topVideos(shop, 7, 60);
    const by = {};
    vids.forEach((v) => (by[v.handle] = (by[v.handle] || 0) + v.gmv));
    const sym = shop.region === "uk" ? "£" : "$";
    const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, s.topN || 5);
    const medals = ["🥇", "🥈", "🥉", "4.", "5.", "6.", "7.", "8.", "9.", "10."];
    return [{
      text: [
        "# 🏆 weekly leaderboard",
        `-# top ${top.length} creators by ${s.metric || "GMV"} · last 7 days`,
        "",
        ...top.map(([h, g], i) => `${medals[i]} ${tag(h, s.tagCreators)} · **${sym}${Math.round(g).toLocaleString()}**`),
        "",
        `${s.everyone ? "@here " : ""}who’s taking the top spot next week? 👀`,
      ].join("\n"),
    }];
  },
};

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function milestoneCard(n, handle) {
  const label = n === 1 ? "SALE" : "SALES";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="840" height="440" viewBox="0 0 840 440"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#CE4272"/><stop offset="1" stop-color="#4C3481"/></linearGradient></defs><rect width="840" height="440" rx="32" fill="url(#g)"/><circle cx="720" cy="90" r="150" fill="#fff" opacity=".08"/><text x="60" y="110" font-family="Montserrat,Arial,sans-serif" font-size="30" font-weight="700" fill="#fff" opacity=".85" letter-spacing="4">CREATOR WIN</text><text x="56" y="280" font-family="Montserrat,Arial,sans-serif" font-size="160" font-weight="800" fill="#fff">${n}</text><text x="${80 + String(n).length * 100}" y="280" font-family="Montserrat,Arial,sans-serif" font-size="56" font-weight="700" fill="#fff">${label}</text><text x="60" y="370" font-family="Poppins,Arial,sans-serif" font-size="34" fill="#fff">@${handle}</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
