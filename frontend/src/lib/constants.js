export const DEFAULT_BOT = "Community bot";

/** App pages by URL hash. */
export const TABS = {
  dashboard: "Dashboard",
  analytics: "Analytics",
  approvals: "Approvals",
  automations: "Automations",
  "automation-builder": "Custom automation",
  onboarding: "Onboarding & DMs",
  content: "Content",
  workspace: "Settings",
};

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const MENTIONS = [["@here", "@here"], ["@everyone", "@everyone"], ["none", "No mention"]];

export const AUTOS = [
  {
    key: "general_chat", n: "01", name: "General chat manager", live: true,
    what: "Replies to creators in your voice. Risky topics go to mods.", hint: ["general-chat", "general"],
    defaults: { replyTo: "questions", dailyCap: 300, escalate: "refunds, missing commission, payment, complaints, legal, medical claims", voice: "" },
  },
  {
    key: "viral_hooks", n: "02", name: "Viral hooks",
    what: "The niche’s most-viewed videos from last week, with how to remake the hook.", hint: ["viral-hooks-and-ideas", "viral-hooks", "viral"],
    defaults: { mode: "manual", days: ["Mon", "Tue", "Wed"], time: "14:00", lookback: 7, mention: "@here", voice: "" },
  },
  {
    key: "winning_content", n: "03", name: "Winning angle of the week",
    what: "Last week’s top video by GMV: numbers, script and how to replicate it.", hint: ["winning-angles", "winning"],
    defaults: { mode: "manual", days: ["Mon", "Tue", "Wed"], time: "12:00", mention: "@here", parts: ["Video post", "Numbers card", "Script card", "How to replicate"], voice: "" },
  },
  {
    key: "wins", n: "04", name: "Creator wins",
    what: "A milestone shoutout the first time a creator hits their 1st, 3rd, 10th, 30th or 50th sale.", hint: ["share-wins", "creator-wins", "wins"],
    defaults: { mode: "manual", days: WEEKDAYS, time: "16:00", thresholds: "1, 3, 10, 30, 50", graphic: true, voice: "" },
  },
  {
    key: "leaderboard", n: "05", name: "Weekly leaderboard",
    what: "Top 5 creators by GMV for the last 7 days.", hint: ["leaderboard"],
    defaults: { mode: "manual", days: ["Mon"], time: "17:00", topN: 5, mention: "@here", voice: "" },
  },
  {
    key: "onboarding", n: "06", name: "Creator onboarding", live: true,
    what: "DMs each new member your questions, links their TikTok and saves the answers.", hint: ["welcome", "introductions"],
    defaults: { reminderHours: 24 },
  },
];
export const autoByKey = (k) => AUTOS.find((a) => a.key === k);

/** Automations that build a draft on a schedule (the others react to Discord as it happens). */
export const BUILDABLE = ["viral_hooks", "winning_content", "wins", "leaderboard"];

export const COMM_TABS = [
  ["overview", "Overview"],
  ["creators", "Creators"],
  ["leaderboard", "Leaderboard"],
  ["channels", "Channels"],
  ["revenue", "Creators × revenue"],
  ["retention", "Retention"],
  ["scoring", "Scoring settings"],
];

export const TIMEZONES = [
  ["America/New_York", "America/New_York (ET)"], ["America/Chicago", "America/Chicago (CT)"], ["America/Denver", "America/Denver (MT)"],
  ["America/Los_Angeles", "America/Los_Angeles (PT)"], ["Europe/London", "Europe/London (UK)"], ["Europe/Berlin", "Europe/Berlin (CET)"],
  ["Asia/Dubai", "Asia/Dubai (GST)"], ["Asia/Karachi", "Asia/Karachi (PKT)"], ["Asia/Kolkata", "Asia/Kolkata (IST)"], ["Asia/Singapore", "Asia/Singapore (SGT)"],
  ["Australia/Sydney", "Australia/Sydney (AET)"],
];

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
    o[a.key] = { enabled: !!channel, channel, ...structuredClone(a.defaults) };
  });
  return o;
}

export function mergeAutos(base, saved) {
  const o = {};
  Object.keys(base).forEach((k) => {
    const s = saved[k] || {};
    // Settings saved before mentions were a choice used an on/off flag.
    const mention = s.mention ?? (s.everyone === false ? "none" : base[k].mention);
    o[k] = { ...base[k], ...s, ...(mention ? { mention } : {}) };
  });
  return o;
}

export const defaultOb = () => ({
  questions: [
    "What’s your TikTok handle?",
    "What kind of content do you usually make?",
    "How many videos can you post a week?",
    "What’s the best way for our team to reach you? (WhatsApp or email)",
  ],
  welcome: "Hey {first_name}, welcome to {server}! 👋 A few quick questions so we can set you up.",
});

export const defaultScoring = () => ({
  cap: 50,
  cooldown: 30,
  excludedChannels: [],
  excludedRoles: [],
  w: { m: 3, rr: 2, pr: 2, ad: 3, rg: 1, v: 1 },
});

export const defaultPrefs = () => ({
  timezone: "America/New_York", weekStart: "Sunday",
  waDetect: true, dmNew: true, reminders: true, notifyDraft: true, notifyDm: true, digest: false,
});

const FULL_DAY = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
const t12 = (t) => {
  const [h, m] = String(t || "").split(":").map(Number);
  if (isNaN(h)) return "";
  return `${h % 12 || 12}:${String(m || 0).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
/** "Mon–Wed · 2:00 PM", "Daily · 4:00 PM", "Mondays · 5:00 PM". */
export function daysTimeText(days = [], time) {
  const d = WEEKDAYS.filter((x) => days.includes(x));
  if (!d.length || !time) return "Not scheduled";
  const idx = d.map((x) => WEEKDAYS.indexOf(x));
  const run = idx.every((v, i) => !i || v === idx[i - 1] + 1);
  const label = d.length === 7 ? "Daily" : d.length === 1 ? FULL_DAY[d[0]] + "s" : run && d.length > 2 ? `${d[0]}–${d[d.length - 1]}` : d.join(", ");
  return `${label} · ${t12(time)}`;
}
export const timeText = t12;

export function scheduleText(a, s) {
  if (a.key === "general_chat") return "Always on";
  if (a.key === "onboarding") return "When someone joins";
  return daysTimeText(s.days, s.time);
}
