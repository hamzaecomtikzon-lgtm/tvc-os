/* Builds the Discord messages for each automation from CRM data. */
import { addDays, todayUTC, ymd } from "./dates.js";
import { ai } from "./ai.js";
import { store } from "./store.js";
import { leaderCard, numbersCard, scriptCard, winCard } from "./cards.js";
import { hash } from "./rng.js";
import { cruvaKeyFor } from "./crm.js";
import { pickViral, videoFrames } from "./viral.js";

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
  const win = typeof days === "number" ? range(days) : { date_from: days.date_from, date_to: days.date_to };
  const { videos } = await crm.searchVideos({ shop_id: shop.id, ...win, sort_by: "gmv", page_size: Math.min(n, 100) });
  return videos.filter((v) => v.gmv > 0).slice(0, n).map((v) => ({
    ...v,
    money: sym(shop) + Math.round(v.gmv).toLocaleString("en-US"),
    hook: v.hooks[0]?.hook || v.title || "this video",
    why: (v.hooks[0]?.explanation || "it opens on the problem and shows the product working within seconds.").replace(/\.?$/, "."),
  }));
}

/** Last full week, Sunday to Saturday, with its labels for the post and the cards. */
function lastWeek() {
  const t = todayUTC();
  const sat = addDays(t, -(((t.getUTCDay() + 1) % 7) || 7));
  const sun = addDays(sat, -6);
  const md = (d, o) => d.toLocaleDateString("en-US", { timeZone: "UTC", ...o });
  const sameMonth = sun.getUTCMonth() === sat.getUTCMonth();
  return {
    date_from: ymd(sun), date_to: ymd(sat),
    label: `Sun ${md(sun, { month: "short", day: "numeric" })} – Sat ${md(sat, { month: "short", day: "numeric" })}`,
    card: `${md(sun, { month: "short", day: "numeric" })} – ${sameMonth ? sat.getUTCDate() : md(sat, { month: "short", day: "numeric" })}, ${sat.getUTCFullYear()}`,
  };
}

/** The video's GMV Max numbers in the window (null when the brand ran no ads on it), with its spend rank. */
async function adsFor(crm, shop, win, videoId) {
  let rows;
  try {
    rows = await crm.adCreatives({ shop_id: shop.id, date_from: win.date_from, date_to: win.date_to });
  } catch (e) {
    console.error("[winning] ad data", e.message);
    return null;
  }
  const i = rows.findIndex((r) => r.video_id === videoId);
  const a = rows[i];
  if (!a || !a.ad_spend || !a.impressions) return null;
  return { spend: a.ad_spend, revenue: a.gross_revenue, impressions: a.impressions, clicks: a.clicks, orders: a.orders, rate2s: a.view_rate_2s, rate6s: a.view_rate_6s, spendRank: i + 1 };
}

/** Claude's breakdown of the video, or one built from the CRM's detected hooks when the AI is off or fails. */
async function analyse(shop, s, v, ads, $) {
  const stats = [
    `${v.money} GMV, ${v.units_sold} units, ${$}${v.commission} commission, ${v.views} views, ${v.comments} comments.`,
    ads ? `Brand ads: ${$}${ads.spend} spend, ${ads.impressions} ad views, ${ads.rate2s.toFixed(1)}% watched 2s (so ${(100 - ads.rate2s).toFixed(0)}% swiped away), ${ads.rate6s.toFixed(1)}% watched 6s, ${ads.clicks} clicks, ${ads.orders} orders.` : "No brand ad spend this week.",
  ].join(" ");
  if (ai.configured()) {
    try {
      const out = await ai.winningAngle({ brand: shop.name, voice: s.voice, video: v, stats });
      if (out?.script?.length && out.replicate?.length) return out;
    } catch (e) {
      console.error("[winning] AI breakdown", e.message);
    }
  }
  const hooks = [...v.hooks].map((x, i) => ({ ...x, i }));
  const best = [...hooks].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
  return {
    product_short: v.product || v.title,
    angle: { line: best?.hook || v.hook, highlight: "", translation: "", summary: `@${v.handle}: ${v.content_overview || v.why}` },
    why_heading: "Why this angle sells",
    why: hooks.slice(0, 3).map((x) => ({ title: `Hook ${x.score || "?"}/10`, title_note: "", body: x.explanation })),
    script: hooks.map((x, n) => ({ label: n ? "Beat " + (n + 1) : "Opening", line: x.hook, translation: "", hook_index: x.i })),
    diagnosis_body: best && best.i > 0 ? "The strongest line came later in the video. Lead with it." : "Keep the opening, tighten the middle.",
    opening: { line: best?.hook || v.hook, translation: "", note: "Product on screen from second 1. Then the proof and the cart." },
    replicate: [
      { title: "Open with the strongest line, face to camera", line: best?.hook || v.hook, translation: "" },
      { title: "Product in frame by second 3", line: "Hold it close to the lens.", translation: "" },
      { title: "Show one honest result", line: "Before and after, or the texture up close.", translation: "" },
      { title: "Keep it under 25 seconds", line: "Cut every pause.", translation: "" },
      { title: "Close on the cart", line: "“I’ll leave it in the orange cart.”", translation: "" },
    ],
    checklist: ["Hook first", "Product early", "One result", "Cart close"],
    closing: ads ? `${Math.round(100 - ads.rate2s)}% swiped in the first 2 seconds. Win those and the brand can scale your video.` : "Remake it this week. lessgoooo 🚀",
  };
}

const mediaUrl = (ns, png) => `/api/media/${store.putMedia(ns, png)}.png`;

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

/** The shoutout for a creator's milestone, in the community lead's voice. Varies by creator so posts don't repeat. */
function winText(handle, n, levels) {
  const t = tag(handle);
  const pick = (opts) => opts[hash(handle + n) % opts.length];
  if (n === 1) return pick([
    `first sale lessgoooo 🎉 massive congrats to ${t}, so happy for you. the first one is always the hardest, but it’s only going upwards from here!!`,
    `${t} just made their FIRST sale 🥳 someone saw your video and bought, that’s the whole game. so proud of you, the next one comes faster!!`,
    `and we have a first sale!! 🎉 huge congrats ${t}, this is where it starts. keep posting, keep going 💪`,
  ]);
  if (n === 3) return pick([
    `hat trick!! ${t} just made their 3rd sale 👏 you’ve got this, keep that momentum going!!`,
    `3 sales for ${t} 🔥 one is luck, three is a pattern. whatever you’re doing, do more of it!!`,
  ]);
  if (n === 10) return pick([
    `YAYYY!! ${t} just hit 10 sales 🎉 that’s 10 people who saw your content and trusted it enough to buy. so proud of you`,
    `DOUBLE DIGITS 🚀 ${t} just crossed 10 sales. that’s real trust from real people, lessgoooo!!`,
  ]);
  if (n === levels[levels.length - 1]) return pick([
    `${n} SALES 🏆 ${t} is officially one of our top sellers. this took consistency and it shows, we’re so proud of you!!`,
    `wow wow wow ${t} just hit ${n} sales 🏆 top seller status unlocked. thank you for everything you put into this!!`,
  ]);
  return pick([
    `${n} sales for ${t} 🔥 you’re on fire, keep going!! the next milestone is closer than you think`,
    `YAYYY ${t} just hit ${n} sales 🎉 that’s consistency paying off. so proud of you!!`,
  ]);
}

/** `await BUILD[automation](shop, settings, { crm, ns, videoId })` → `[{ text, images? }]`, one entry per Discord message. `crm` is the workspace's tools from crmFor(). */
export const BUILD = {
  async viral_hooks(shop, s, { crm, ns, tz, rank }) {
    const win = s.lookback && s.lookback !== 7 ? { ...range(s.lookback), label: `last ${s.lookback} days` } : lastWeek();
    // One video a day: the 1st scheduled day of the week posts #1, the 2nd posts #2, and so on.
    if (!rank) {
      const today = new Intl.DateTimeFormat("en-US", { timeZone: tz || "America/New_York", weekday: "short" }).format(new Date());
      const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].filter((d) => (s.days || []).includes(d));
      rank = Math.max(1, order.indexOf(today) + 1);
    }
    const { video: v, source } = await pickViral({ crm, shop, niche: s.niche || "", from: win.date_from, to: win.date_to, rank, apiKey: cruvaKeyFor(ns) });
    if (!v) return [{ text: `no videos with views in the ${win.label.startsWith("last") ? win.label : "last week"} yet. we’ll be back next time 💪` }];

    const product = s.product || (await crm.topProducts({ shop_id: shop.id, date_from: win.date_from, date_to: win.date_to }).catch(() => []))[0]?.name || shop.name;
    const shot = cruvaKeyFor(ns) ? await videoFrames(cruvaKeyFor(ns), shop.id, v).catch((e) => (console.error("[viral] frames", e.message), null)) : null;
    let a = null;
    if (ai.configured()) {
      try {
        a = await ai.viralAngle({ brand: shop.name, voice: s.voice, video: v, frames: shot?.frames || [], duration: shot?.duration, caption: shot?.caption, product, rules: s.rules, language: s.language });
      } catch (e) {
        console.error("[viral] AI breakdown", e.message);
      }
    }
    const nicheLabel = s.nicheLabel || (source === "market" ? (s.niche || "").split(",")[0].trim() : "") || shop.name;
    const head = [
      ping(s),
      `# 🔥 VIRAL ANGLE OF THE WEEK (#${rank})`,
      `**${nicheLabel.charAt(0).toUpperCase() + nicheLabel.slice(1)} · ${win.label}**`,
      `**${k(v.views).toUpperCase()} views** · @${v.handle} · ${a?.product_short || String(v.product).split(/\s+[-–|,]\s+/)[0]}`,
      v.link,
    ].filter(Boolean).join("\n");

    if (!a) {
      const hook = v.hooks?.[0];
      return [{ text: head }, {
        text: [
          `# 🪝 THE HOOK: “${hook?.hook || "watch the first 2 seconds"}”`,
          hook?.explanation || v.overview || "",
          "",
          "# 🚀 MAKE IT WORK FOR US",
          "**1- Same opening, your face, our product in hand by second 2.**",
          "**2- One honest result, close to the lens.**",
          "**3- Close on the orange cart.**",
        ].join("\n"),
      }];
    }
    const sub = (t) => (t ? `-# (${t})` : null);
    const body = [
      `# 🪝 THE HOOK: ${a.hook_title}`,
      `-# ${[a.hook_translation ? `(${a.hook_translation})` : "", a.hook_note].filter(Boolean).join(" · ")}`,
      a.why,
      ...a.beats.slice(0, 4).flatMap((b, i) => [`**${i + 1}- ${b.title.replace(/:$/, "")}:**`, b.body]),
      "",
      `# 🚀 MAKE IT WORK FOR OUR ${a.adapt_name.toUpperCase()}`,
      a.adapt_intro,
      ...a.steps.slice(0, 5).flatMap((st, i) => [
        `**${i + 1}- ${st.title.replace(/:$/, "")}:**`,
        [st.action, st.line ? `“${st.line}”` : ""].filter(Boolean).join(" "),
        sub(st.translation),
      ]),
      a.on_brief.length ? `✅ **On-brief:** ${a.on_brief.join(" · ")}` : null,
    ].filter((x) => x !== null && x !== "-# ").join("\n");
    return [{ text: head }, { text: body }];
  },

  async winning_content(shop, s, { videoId, crm, ns }) {
    const week = lastWeek();
    let v = null;
    let win = week;
    if (videoId) {
      // A video picked by hand: last week's numbers if it sold then, otherwise the last 30 days.
      v = (await topVideos(crm, shop, week, 100)).find((x) => x.video_id === videoId);
      if (!v) {
        win = { ...range(30), label: "Last 30 days", card: "Last 30 days" };
        v = (await topVideos(crm, shop, win, 100)).find((x) => x.video_id === videoId);
      }
    } else [v] = await topVideos(crm, shop, week, 1);
    if (!v) return [{ text: "no winning video last week. we’ll be back next monday 💪" }];

    const parts = s.parts || ["Video post", "Numbers card", "Script card", "How to replicate"];
    const $ = sym(shop);
    const ads = await adsFor(crm, shop, win, v.video_id);
    const swiped = ads ? Math.round(100 - ads.rate2s) : null;
    const angle = await analyse(shop, s, v, ads, $);
    const product = angle.product_short || v.product || v.title || "the product";
    const msgs = [];

    if (parts.includes("Video post"))
      msgs.push({
        text: [
          ping(s),
          "# 🏆 WINNING CONTENT ANGLE OF THE WEEK",
          `**${shop.name} · ${win.label}**`,
          `**#1 video by GMV: ${tag(v.handle)}**`,
          (v.title || product).split(/\s+[-–|]\s+/)[0],
          v.video_link,
        ].filter(Boolean).join("\n"),
      });

    const cardBase = { brand: shop.name, period: win.card, handle: v.handle };
    if (parts.includes("Numbers card")) {
      try {
        const png = await numbersCard({ ...cardBase, sym: $, product, views: v.views, gmv: v.gmv, units: v.units_sold, commission: v.commission, ads });
        msgs.push({ text: "", images: [mediaUrl(ns, png)] });
      } catch (e) {
        console.error("[winning] numbers card", e);
        msgs.push({ text: `**the numbers**\n💰 ${v.money} GMV\n👀 ${k(v.views)} views\n🛒 ${v.units_sold} units sold` });
      }
    }
    if (parts.includes("Script card")) {
      try {
        const png = await scriptCard({
          ...cardBase,
          angle: angle.angle, whyHeading: angle.why_heading,
          why: angle.why.map((w) => ({ title: w.title, note: w.title_note, body: w.body })),
          script: angle.script.map((r, i, all) => ({
            label: r.label, line: r.line, translation: r.translation,
            score: v.hooks[r.hook_index]?.score || null,
            badge: i === all.length - 1 && v.comments ? `${v.comments} comment${v.comments === 1 ? "" : "s"}` : null,
          })),
          diagnosis: { headline: swiped != null ? `${swiped}% swiped` : "Lead with it", body: (swiped != null ? "in 2 seconds. " : "") + angle.diagnosis_body },
          opening: angle.opening,
        });
        msgs.push({ text: "", images: [mediaUrl(ns, png)] });
      } catch (e) {
        console.error("[winning] script card", e);
        msgs.push({ text: `**the script**\n${angle.script.map((r) => `${r.label}: “${r.line}”`).join("\n")}` });
      }
    }
    if (parts.includes("How to replicate")) {
      const sub = (t) => (t ? `-# (${t})` : null);
      msgs.push({
        text: [
          "# 🚀 HOW TO REPLICATE THIS ANGLE FOR MAX AD SPEND",
          ...angle.replicate.slice(0, 5).flatMap((r, i) => [`**${i + 1}- ${r.title.replace(/:$/, "")}:**`, r.translation ? `“${r.line}”` : r.line, sub(r.translation)]),
          `✅ **Remake checklist:**`,
          angle.checklist.join(" · "),
          "",
          `**${angle.closing}**`,
        ].filter((x) => x !== null).join("\n"),
      });
    }
    return msgs.length ? msgs : [{ text: "nothing selected to include. turn on at least one part in settings." }];
  },

  async wins(shop, s, { crm, ns }) {
    const levels = [...new Set(String(s.thresholds || "1, 3, 10, 30, 50").split(",").map((x) => parseInt(x, 10)).filter((x) => x > 0))].sort((a, b) => a - b);
    // A win is the day a creator's all-time sales (last 365 days) cross a milestone: yesterday's total vs the day before.
    const y = addDays(todayUTC(), -1);
    const start = ymd(addDays(y, -364));
    const [now, before] = await Promise.all([
      crm.listCreators({ shop_id: shop.id, date_from: start, date_to: ymd(y) }),
      crm.listCreators({ shop_id: shop.id, date_from: start, date_to: ymd(addDays(y, -1)) }),
    ]);
    const prev = new Map(before.map((c) => [c.handle, c.sales]));
    const hits = now
      .map((c) => ({ c, n: levels.filter((l) => l > (prev.get(c.handle) || 0) && l <= c.sales).pop() }))
      .filter((x) => x.n)
      .sort((a, b) => b.n - a.n || b.c.sales - a.c.sales)
      .slice(0, s.max || 5);
    if (!hits.length) return [{ text: "no new milestones yesterday. today’s yours 💪" }];
    const out = [];
    for (const { c, n } of hits) {
      let images = [];
      if (s.graphic !== false) {
        try {
          images = [mediaUrl(ns, await winCard({ brand: shop.name, handle: c.handle, n, levels }))];
        } catch (e) {
          console.error("[wins] card", e);
        }
      }
      out.push({ text: winText(c.handle, n, levels), images });
    }
    return out;
  },

  async leaderboard(shop, s, { crm, ns }) {
    const week = lastWeek();
    const creators = await crm.listCreators({ shop_id: shop.id, date_from: week.date_from, date_to: week.date_to });
    const top = creators.filter((c) => c.gmv > 0).slice(0, s.topN || 5);
    if (!top.length) return [{ text: "no creator sales last week yet. the leaderboard is wide open 👀" }];
    const $ = sym(shop);
    const medals = ["🥇", "🥈", "🥉"];
    const money = (v) => $ + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    let images = [];
    if (s.graphic !== false) {
      try {
        images = [mediaUrl(ns, await leaderCard({ brand: shop.name, period: week.card, sym: $, top }))];
      } catch (e) {
        console.error("[leaderboard] card", e);
      }
    }
    return [{
      text: [
        ping(s),
        "# 🏆 WEEKLY TOP CREATORS",
        `**${week.label}**`,
        ...top.map((c, i) => `${medals[i] || `${i + 1}.`} ${tag(c.handle)} · **${money(c.gmv)}**`),
        `massive congrats to this week’s top ${top.length} :)) drop some love for them below 🎉`,
      ].filter(Boolean).join("\n"),
      images,
    }];
  },
};
