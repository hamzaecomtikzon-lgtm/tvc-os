/* Builds the Discord messages for each automation from CRM data. */
import { addDays, todayUTC, ymd } from "./dates.js";

export const AUTO_NAMES = {
  viral_hooks: "Viral hooks & angles",
  winning_content: "Winning angle of the week",
  wins: "Creator wins",
  leaderboard: "Weekly leaderboard",
};

const sym = (shop) => (shop.region === "uk" ? "£" : "$");
const range = (days) => ({ date_from: ymd(addDays(todayUTC(), -days)), date_to: ymd(addDays(todayUTC(), -1)) });

/** The shop's best videos by GMV over the last `days` days, from the CRM. */
async function topVideos(crm, shop, days, n) {
  const { videos } = await crm.searchVideos({ shop_id: shop.id, ...range(days), sort_by: "gmv", page_size: Math.min(n, 100) });
  return videos.filter((v) => v.gmv > 0).slice(0, n).map((v) => ({
    ...v,
    money: sym(shop) + Math.round(v.gmv).toLocaleString("en-US"),
    hook: v.hooks[0]?.hook || v.title || "this video",
    why: (v.hooks[0]?.explanation || "it opens on the problem and shows the product working within seconds.").replace(/\.?$/, "."),
  }));
}

/** Creators by GMV over the last `days` days, from the CRM. */
async function topCreators(crm, shop, days) {
  return (await crm.listCreators({ shop_id: shop.id, ...range(days) })).filter((c) => c.gmv > 0);
}

// Creators are tagged in Discord only once onboarding has linked their TikTok to a
// real Discord member. Until then everyone shows as their @handle.
const tag = (handle) => "@" + handle;
/** The mention an automation opens or closes with ("" when it is set to none). */
const ping = (s) => (s.mention === "none" || s.everyone === false ? "" : s.mention === "@everyone" ? "@everyone" : "@here");
const k = (v) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "k" : String(Math.round(v)));

/** Preview card shown in Approvals. Discord gets the text; the card isn't uploaded yet. */
function milestoneCard(n, handle) {
  const label = n === 1 ? "SALE" : "SALES";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="840" height="440" viewBox="0 0 840 440"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#CE4272"/><stop offset="1" stop-color="#4C3481"/></linearGradient></defs><rect width="840" height="440" rx="32" fill="url(#g)"/><circle cx="720" cy="90" r="150" fill="#fff" opacity=".08"/><text x="60" y="110" font-family="Montserrat,Arial,sans-serif" font-size="30" font-weight="700" fill="#fff" opacity=".85" letter-spacing="4">CREATOR WIN</text><text x="56" y="280" font-family="Montserrat,Arial,sans-serif" font-size="160" font-weight="800" fill="#fff">${n}</text><text x="${80 + String(n).length * 100}" y="280" font-family="Montserrat,Arial,sans-serif" font-size="56" font-weight="700" fill="#fff">${label}</text><text x="60" y="370" font-family="Poppins,Arial,sans-serif" font-size="34" fill="#fff">@${handle}</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

/** `await BUILD[automation](shop, settings, { crm })` → `[{ text, images? }]`, one entry per Discord message. `crm` is the workspace's tools from crmFor(). */
export const BUILD = {
  async viral_hooks(shop, s, { crm }) {
    const days = s.lookback || 7;
    const vids = await topVideos(crm, shop, days, 3);
    if (!vids.length) return [{ text: `no videos with sales in the last ${days} days yet. we’ll be back next time 💪` }];
    return [{
      text: [
        "# 🔥 viral hooks of the week",
        `-# top ${vids.length} videos by GMV · last ${days} days`,
        "",
        ...vids.flatMap((v, i) => [
          `**${i + 1}. “${v.hook}”** by @${v.handle}`,
          `${k(v.views)} views · ${v.money} GMV`,
          `why it works: ${v.why} open the same way, swap in your own product shot in the first 2 seconds.`,
          v.video_link,
          "",
        ]),
        (ping(s) + " go film one today 🎬").trim(),
      ].join("\n"),
    }];
  },

  async winning_content(shop, s, { videoId, crm }) {
    const [v] = videoId ? (await topVideos(crm, shop, 120, 100)).filter((x) => x.video_id === videoId) : await topVideos(crm, shop, 7, 1);
    if (!v) return [{ text: "no winning video last week. we’ll be back next monday 💪" }];
    const parts = s.parts || ["Video post", "Numbers card", "Script card", "How to replicate"];
    const msgs = [];
    if (parts.includes("Video post"))
      msgs.push({ text: `# 🏆 winning angle of the week\n-# last week’s #1 video by GMV\n\nhuge shoutout to ${tag(v.handle)} for this one YAYYY\n${v.video_link}${ping(s) ? "\n\n" + ping(s) : ""}` });
    if (parts.includes("Numbers card"))
      msgs.push({ text: `**the numbers**\n💰 ${v.money} GMV\n👀 ${k(v.views)} views\n🛒 ${v.units_sold} units sold` });
    if (parts.includes("Script card"))
      msgs.push({ text: `**the script**\nhook: “${v.hook}”\nmiddle: show the product in hand, one honest result, one texture shot\nclose: “link’s in the orange cart, grab it before the sale ends”` });
    if (parts.includes("How to replicate"))
      msgs.push({ text: `**how to replicate**\n1. film the hook in one take, face to camera\n2. why it works: ${v.why}\n3. keep it under 25 seconds\n4. pin the shop link in the first comment\nlessgoooo 🚀` });
    return msgs.length ? msgs : [{ text: "nothing selected to include. turn on at least one part in settings." }];
  },

  async wins(shop, s, { crm }) {
    const levels = String(s.thresholds || "1, 3, 10, 30, 50").split(",").map((x) => parseInt(x, 10)).filter(Boolean).sort((a, b) => a - b);
    // Creators whose sales this week reached a milestone, biggest first.
    const hits = (await topCreators(crm, shop, 7))
      .map((c) => ({ c, n: levels.filter((l) => l <= c.sales).pop() }))
      .filter((x) => x.n)
      .sort((a, b) => b.n - a.n || b.c.sales - a.c.sales)
      .slice(0, 3);
    if (!hits.length) return [{ text: "no new milestones this week. next week’s yours 💪" }];
    return hits.map(({ c, n }) => ({
      text: `YAYYY ${tag(c.handle)} hit **${n}+ ${n === 1 ? "sale" : "sales"}** on TikTok Shop this week 🎉 lessgoooo`,
      images: s.graphic === false ? [] : [milestoneCard(n, c.handle)],
    }));
  },

  async leaderboard(shop, s, { crm }) {
    const top = (await topCreators(crm, shop, 7)).slice(0, s.topN || 5).map((c) => [c.handle, c.gmv]);
    if (!top.length) return [{ text: "no creator sales in the last 7 days yet. the leaderboard is wide open 👀" }];
    const medals = ["🥇", "🥈", "🥉", "4.", "5.", "6.", "7.", "8.", "9.", "10."];
    return [{
      text: [
        "# 🏆 weekly leaderboard",
        `-# top ${top.length} creators by GMV · last 7 days`,
        "",
        ...top.map(([h, g], i) => `${medals[i]} ${tag(h)} · **${sym(shop)}${Math.round(g).toLocaleString("en-US")}**`),
        "",
        (ping(s) + " who’s taking the top spot next week? 👀").trim(),
      ].join("\n"),
    }];
  },
};
