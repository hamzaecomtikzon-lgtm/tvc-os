/* Builds the Discord messages for each automation from CRM data. */
import { MEMBERS, lifeFraction, videoPool } from "./sampleData.js";
import { addDays, todayUTC, ymd } from "./dates.js";

export const AUTO_NAMES = {
  viral_hooks: "Viral hooks & angles",
  winning_content: "Winning angle of the week",
  wins: "Creator wins",
  leaderboard: "Weekly leaderboard",
};

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
    .map((v) => ({ ...v, money: sym + Math.round(v.gmv).toLocaleString("en-US") }));
}

// Creators are tagged in Discord only once onboarding has linked their TikTok to a
// real Discord member. Until then everyone shows as their @handle.
const tag = (handle) => "@" + handle;
/** The mention an automation opens or closes with ("" when it is set to none). */
const ping = (s) => (s.mention === "none" || s.everyone === false ? "" : s.mention === "@everyone" ? "@everyone" : "@here");
const k = (v) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "k" : String(Math.round(v)));

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Preview card shown in Approvals. Discord gets the text; the card isn't uploaded yet. */
function milestoneCard(n, handle) {
  const label = n === 1 ? "SALE" : "SALES";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="840" height="440" viewBox="0 0 840 440"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#CE4272"/><stop offset="1" stop-color="#4C3481"/></linearGradient></defs><rect width="840" height="440" rx="32" fill="url(#g)"/><circle cx="720" cy="90" r="150" fill="#fff" opacity=".08"/><text x="60" y="110" font-family="Montserrat,Arial,sans-serif" font-size="30" font-weight="700" fill="#fff" opacity=".85" letter-spacing="4">CREATOR WIN</text><text x="56" y="280" font-family="Montserrat,Arial,sans-serif" font-size="160" font-weight="800" fill="#fff">${n}</text><text x="${80 + String(n).length * 100}" y="280" font-family="Montserrat,Arial,sans-serif" font-size="56" font-weight="700" fill="#fff">${label}</text><text x="60" y="370" font-family="Poppins,Arial,sans-serif" font-size="34" fill="#fff">@${handle}</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

/** `BUILD[automation](shop, settings)` → `[{ text, images? }]`, one entry per Discord message. */
export const BUILD = {
  viral_hooks(shop, s) {
    const days = s.lookback || 7;
    const vids = topVideos(shop, days, 3);
    return [{
      text: [
        "# 🔥 viral hooks of the week",
        `-# top 3 videos in the market · last ${days} days`,
        "",
        ...vids.flatMap((v, i) => [
          `**${i + 1}. “${v.hooks[0].hook}”** by @${v.handle}`,
          `${k(v.views)} views · ${v.money} GMV`,
          `how to remake it: ${v.hooks[0].explanation.toLowerCase()} open the same way, swap in your own product shot in the first 2 seconds.`,
          v.video_link,
          "",
        ]),
        (ping(s) + " go film one today 🎬").trim(),
      ].join("\n"),
    }];
  },

  winning_content(shop, s, { videoId } = {}) {
    const [v] = videoId ? topVideos(shop, 120, 500).filter((x) => x.video_id === videoId) : topVideos(shop, 7, 1);
    if (!v) return [{ text: "no winning video last week. we’ll be back next monday 💪" }];
    const parts = s.parts || ["Video post", "Numbers card", "Script card", "How to replicate"];
    const msgs = [];
    if (parts.includes("Video post"))
      msgs.push({ text: `# 🏆 winning angle of the week\n-# last week’s #1 video by GMV\n\nhuge shoutout to ${tag(v.handle)} for this one YAYYY\n${v.video_link}${ping(s) ? "\n\n" + ping(s) : ""}` });
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
    return MEMBERS.filter((m) => m.linked).slice(4, 7).map((m, i) => {
      const n = levels[Math.min(i + 1, levels.length - 1)] || 1;
      return {
        text: `YAYYY ${tag(m.tiktok)} just hit their **${ordinal(n)} sale** on TikTok Shop 🎉 lessgoooo`,
        images: s.graphic === false ? [] : [milestoneCard(n, m.tiktok)],
      };
    });
  },

  leaderboard(shop, s) {
    const by = {};
    topVideos(shop, 7, 60).forEach((v) => (by[v.handle] = (by[v.handle] || 0) + v.gmv));
    const sym = shop.region === "uk" ? "£" : "$";
    const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, s.topN || 5);
    const medals = ["🥇", "🥈", "🥉", "4.", "5.", "6.", "7.", "8.", "9.", "10."];
    return [{
      text: [
        "# 🏆 weekly leaderboard",
        `-# top ${top.length} creators by ${s.metric || "GMV"} · last 7 days`,
        "",
        ...top.map(([h, g], i) => `${medals[i]} ${tag(h)} · **${sym}${Math.round(g).toLocaleString("en-US")}**`),
        "",
        (ping(s) + " who’s taking the top spot next week? 👀").trim(),
      ].join("\n"),
    }];
  },
};
