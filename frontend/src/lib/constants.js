import { HOME_GUILD } from "../services/mockData.js";

export { HOME_GUILD };
export const BOT_CLIENT_ID = "1565126862714175620";
export const BOT_PERMS = "247952";
export const INSTALL_URL = `https://discord.com/oauth2/authorize?client_id=${BOT_CLIENT_ID}&scope=bot%20applications.commands&permissions=${BOT_PERMS}`;

export const DEFAULT_BOT = "hayfa - community lead";
export const DEFAULT_TONE = "lowercase, short and hype (YAYYY, lessgoooo), one emoji at the end, no trailing x.";

export const TABS = {
  overview: "Overview",
  content: "Content",
  community: "Community",
  automations: "Automations",
  approvals: "Approvals",
  onboarding: "Onboarding",
  setup: "Bot & channels",
  welcome: "Setup guide",
};
export const SHOP_TABS = ["overview", "content", "community"];
export const DISCORD_TABS = ["automations", "approvals", "onboarding", "setup"];

export const AUTOS = [
  {
    key: "general_chat", n: "01", name: "General chat manager",
    what: "Replies in the community lead’s voice. Flags risky topics.", hint: [],
    defaults: { mode: "flag", replyTo: "all", dailyCap: 300, escalate: "refunds, missing commission, payment, complaints, legal, medical claims", quietStart: "", quietEnd: "" },
  },
  {
    key: "viral_hooks", n: "02", name: "Viral hooks & angles", skill: "discord-tvc-viral-hooks-and-angles",
    what: "Top 3 market videos of the week and how to remake them.", hint: ["viral-hooks", "viral"],
    defaults: { mode: "manual", days: ["Mon", "Tue", "Wed"], time: "14:00", lookback: 7, count: 1, everyone: true },
  },
  {
    key: "winning_content", n: "03", name: "Winning angle of the week", skill: "tvc-discord-community-weekly-angle-of-the-week",
    what: "Last week’s top 3 videos by GMV, with remake guides.", hint: ["winning-angles", "winning"],
    defaults: { mode: "manual", days: ["Mon", "Tue", "Wed"], time: "12:00", count: 3, tagCreator: true, everyone: true, parts: ["Video post", "Numbers card", "Script card", "How to replicate"] },
  },
  {
    key: "wins", n: "04", name: "Creator wins", skill: "discord-tvc-creator-wins",
    what: "Celebrates 1st, 3rd, 10th, 30th and 50th sales.", hint: ["share-wins", "wins"],
    defaults: { mode: "manual", thresholds: "1, 3, 10, 30, 50", checkEvery: 1440, time: "16:00", tagCreator: true, graphic: true, handleFallback: true },
  },
  {
    key: "leaderboard", n: "05", name: "Weekly leaderboard", skill: "discord-tvc-weekly-leaderboard",
    what: "Top 5 creators by GMV, every Monday.", hint: ["leaderboard"],
    defaults: { mode: "manual", days: ["Mon"], time: "17:00", topN: 5, metric: "GMV", tagCreators: true, everyone: true },
  },
  {
    key: "onboarding", n: "06", name: "Creator onboarding",
    what: "DMs new members and links their TikTok.", hint: [],
    defaults: { mode: "flag", linkFirst: true, reminderHours: 24, maxReminders: 1, fallback: "private-channel" },
  },
];
export const autoByKey = (k) => AUTOS.find((a) => a.key === k);

export const MODE_LABEL = { auto: "Auto", flag: "Auto with flagging", manual: "Manual approval" };
export const WIN_PARTS = ["Video post", "Numbers card", "Script card", "How to replicate"];

/** Automations whose skill can build a test draft. */
export const BUILDABLE = ["viral_hooks", "winning_content", "wins", "leaderboard"];

export const KPI = [
  ["total_gmv", "Total GMV", "money", "Entire TikTok Shop GMV."],
  ["affiliate_gmv", "Affiliate GMV", "money", "GMV from affiliate creators."],
  ["ads_gmv", "Ads GMV", "money", "Affiliate GMV from orders that ran in shop ads (GMV Max)."],
  ["organic_gmv", "Organic GMV", "money", "Affiliate GMV that didn’t come through ads."],
  ["commission", "Commission paid", "money", "Commission earned by creators."],
  ["daily_active_affiliates", "Creators with sales", "int", "Creators earning any GMV in the range."],
  ["videos_posted", "Videos posted", "int", "Affiliate videos posted in the range."],
  ["video_views", "Video views", "int", "Views on affiliate videos."],
  ["sample_requests", "Sample requests", "int", "Requests submitted in the range."],
  ["samples_approved", "Samples approved", "int", "Approved in the range, whatever their status today."],
  ["samples_delivered", "Samples delivered", "int", "Delivered to creators in the range."],
  ["dms_sent", "Outreach DMs", "int", "All outreach DMs sent."],
];

export const COMM_TABS = [
  ["overview", "Overview"],
  ["leaderboard", "Leaderboard"],
  ["channels", "Channels"],
  ["revenue", "Creators × revenue"],
  ["retention", "Retention"],
  ["scoring", "Scoring settings"],
];

export const STATUS = {
  pending: ["Waiting", ""],
  working: ["Being built", ""],
  posting: ["Posting…", ""],
  posted: ["Posted", "good"],
  approved: ["Approved", "good"],
  rejected: ["Rejected", "line"],
  replaced: ["Regenerated", "line"],
  failed: ["Failed", "bad"],
};

export const ACCESS_HELP =
  "In Discord, open the channel’s settings → Permissions → Add members or roles → your bot, then allow View Channel, Send Messages, Embed Links and Read Message History. Then press Re-sync From Discord in Bot & channels.";

export function guessChannel(channels, hints) {
  for (const h of hints) {
    const c = channels.find((x) => x.name === h) || channels.find((x) => x.name.includes(h));
    if (c) return c.id;
  }
  return "";
}

export function defaultAutos(channels) {
  const o = {};
  AUTOS.forEach((a) => {
    const channel = guessChannel(channels, a.hint);
    o[a.key] = { enabled: !!channel, channel, reminderHours: 4, expireHours: 24, ...structuredClone(a.defaults) };
  });
  return o;
}

export function mergeAutos(base, saved) {
  const o = {};
  Object.keys(base).forEach((k) => (o[k] = { ...base[k], ...(saved[k] || {}) }));
  return o;
}

export const defaultOb = () => ({
  questions: [
    "What’s your TikTok handle?",
    "What kind of content do you mostly make?",
    "Have you sold on TikTok Shop before? Roughly how much?",
    "What would help you most here: samples, content ideas or commission boosts?",
  ],
  welcome: "Hey {name}, welcome to the {brand} creator community. Quick hello so we can help you sell more.",
});

export const defaultScoring = () => ({
  cap: 50,
  cooldown: 30,
  excludedChannels: [],
  excludedRoles: [],
  w: { m: 1, rr: 1, pr: 1.5, ad: 2, rg: 0.5, v: 0.5 },
});

export function scheduleText(a, s) {
  if (a.key === "general_chat") return "Every message";
  if (a.key === "wins") return "Daily " + (s.time || "16:00") + " ET · " + s.thresholds;
  if (a.key === "onboarding") return "When a member joins";
  return (s.days || []).join(" · ") + " " + (s.time || "") + " ET" + (s.everyone ? " · @here" : "");
}
