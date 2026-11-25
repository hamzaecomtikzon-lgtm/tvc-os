/*
 * Server layouts for the AI Community Builder. Each template is a list of categories,
 * each with channels as { e: emoji, name, perm, desc, auto? }. `auto` ties a channel to an
 * automation slot (see SLOTS in setup.js) so it's picked as that automation's channel when created.
 * Every template ends with the private moderators category that holds the approvals channel.
 */

const MODS = (extra = []) => ({
  cat: "🔒 MODERATORS", about: "Hidden from creators. Only your mods and the bot can see it.", priv: true,
  ch: [{ e: "", name: "moderator-only", perm: "mods", desc: "Every draft waits here for approval", auto: "mod" }, ...extra],
});
const ch = {
  announcements: { e: "📢", name: "announcements", perm: "read", desc: "Launches, promos and commission changes" },
  rules: { e: "📌", name: "rules", perm: "read", desc: "Community guidelines and posting rules" },
  welcome: { e: "👋", name: "welcome", perm: "read", desc: "Bot welcome and how the community works", auto: "onboarding" },
  intros: { e: "🙋", name: "introductions", perm: "everyone", desc: "New creators say hi and drop their TikTok" },
  general: { e: "💬", name: "general-chat", perm: "everyone", desc: "Day-to-day chat, answered by your bot", auto: "general_chat" },
  leaderboard: { e: "📊", name: "leaderboard", perm: "read", desc: "Monday top 5 creators by GMV", auto: "leaderboard" },
  wins: { e: "🏆", name: "share-wins", perm: "everyone", desc: "Milestone cards from the bot, and creators share their own wins", auto: "wins" },
  angles: { e: "🔥", name: "winning-angles", perm: "read", desc: "Last week’s top videos by GMV, broken down", auto: "winning_content" },
  hooks: { e: "📷", name: "viral-hooks", perm: "read", desc: "The niche’s most-viewed hooks and how to use them", auto: "viral_hooks" },
};

export const TEMPLATES = [
  {
    id: "creator-community", icon: "🌟", name: "Creator Community", tagline: "The all-round layout: onboarding, a creator hub with wins and winning angles, support and a mods area.",
    bestFor: "Most TikTok Shop brands", keywords: ["community", "creator", "general", "affiliate", "brand"],
    cats: [
      { cat: "👋 GET STARTED", about: "First stop for every new creator: what this is, the rules, and where to say hi.", ch: [ch.announcements, ch.rules, ch.welcome, ch.intros, ch.general, ch.leaderboard] },
      { cat: "🌟 CREATOR HUB", about: "Everything that helps creators sell: wins, winning angles, hooks, briefs and links.", ch: [
        ch.wins, ch.angles,
        { e: "🎥", name: "video-feedback", perm: "everyone", desc: "Creators post drafts and get feedback" },
        { ...ch.hooks, name: "viral-hooks-and-ideas" },
        { e: "📝", name: "content-briefs", perm: "read", desc: "Your creator brief and talking points" },
        { e: "🔗", name: "affiliate-links", perm: "read", desc: "Product links and sample request steps" } ] },
      { cat: "❓ SUPPORT", about: "Private help for samples, payouts and problems.", ch: [{ e: "🎫", name: "open-a-ticket", perm: "everyone", desc: "Opens a private ticket with your team" }] },
      { cat: "📹 MULTI PLATFORM", about: "For creators who also post on Instagram and Facebook.", ch: [{ e: "📱", name: "meta-creators", perm: "everyone", desc: "Meta programs, Reels tips and cross-posting" }] },
      MODS(),
    ],
  },
  {
    id: "sales-engine", icon: "💰", name: "Affiliate Sales Engine", tagline: "Built around GMV: winning angles, product drops, commission news, rankings and sample requests up front.",
    bestFor: "Brands pushing sales and GMV", keywords: ["sales", "gmv", "sell", "revenue", "commission", "sample", "product", "launch", "drop", "deal"],
    cats: [
      { cat: "📣 START HERE", about: "The essentials every creator needs on day one.", ch: [ch.announcements, ch.rules, ch.welcome, ch.general] },
      { cat: "💰 SELL MORE", about: "What’s selling right now and how to copy it.", ch: [
        ch.angles, ch.hooks,
        { e: "🛍️", name: "product-drops", perm: "read", desc: "New products, price drops and flash deals" },
        { e: "💸", name: "commission-updates", perm: "read", desc: "Commission rates, bonuses and boosted campaigns" } ] },
      { cat: "🏆 WINS & RANKINGS", about: "Recognition that keeps creators posting.", ch: [
        ch.wins, ch.leaderboard,
        { e: "🎯", name: "gmv-challenges", perm: "read", desc: "Weekly GMV challenges and prizes" } ] },
      { cat: "📦 SAMPLES", about: "Free samples in, videos out.", ch: [
        { e: "📦", name: "request-samples", perm: "everyone", desc: "How to request a free sample, and questions about it" },
        { e: "🚚", name: "sample-tracking", perm: "read", desc: "Shipped samples and the video each one is due" } ] },
      MODS([{ e: "", name: "sales-reports", perm: "mods", desc: "Weekly numbers for the team" }]),
    ],
  },
  {
    id: "lean-starter", icon: "🚀", name: "Lean Starter", tagline: "Just the essentials in 7 channels. Easy to run with a small team, grow it later.",
    bestFor: "New communities, under 50 creators", keywords: ["small", "simple", "new", "start", "starter", "minimal", "few", "lean", "basic"],
    cats: [
      { cat: "👋 COMMUNITY", about: "Where creators land, get the news and chat.", ch: [ch.announcements, ch.welcome, ch.general] },
      { cat: "🚀 GROW", about: "The three posts that matter most: what’s working, wins and the leaderboard.", ch: [ch.angles, ch.wins, ch.leaderboard] },
      MODS(),
    ],
  },
  {
    id: "creator-academy", icon: "🎓", name: "Creator Academy", tagline: "Teach creators to make videos that sell: a step-by-step guide, hook library, scripts and weekly feedback.",
    bestFor: "Beginner creators who need coaching", keywords: ["learn", "teach", "education", "academy", "beginner", "course", "training", "coach", "lesson", "tips", "feedback"],
    cats: [
      { cat: "🎓 START HERE", about: "Welcome, rules and a place to say hi.", ch: [ch.announcements, ch.rules, ch.welcome, ch.intros, ch.general] },
      { cat: "📚 LEARN", about: "Lessons and libraries creators can come back to.", ch: [
        { e: "🧭", name: "start-here-guide", perm: "read", desc: "Step by step: from first video to first sale" },
        ch.hooks, ch.angles,
        { e: "📝", name: "script-templates", perm: "read", desc: "Proven scripts to copy and adapt" },
        { e: "✂️", name: "editing-tips", perm: "read", desc: "CapCut tips, captions and pacing" } ] },
      { cat: "🎬 PRACTICE", about: "Make videos, get notes, get featured.", ch: [
        { e: "🎥", name: "video-feedback", perm: "everyone", desc: "Post a draft, get notes from the team" },
        { e: "📅", name: "weekly-challenge", perm: "read", desc: "One brief a week; the best video gets featured" },
        ch.wins ] },
      { cat: "🙋 HELP", about: "Questions about content, samples or the shop.", ch: [{ e: "❓", name: "ask-a-question", perm: "everyone", desc: "Ask the team anything" }] },
      MODS(),
    ],
  },
  {
    id: "live-sellers", icon: "🔴", name: "LIVE Selling Hub", tagline: "For brands running TikTok LIVE hosts: the LIVE schedule, host coaching, replays and retainer hosts.",
    bestFor: "Brands selling through TikTok LIVE", keywords: ["live", "host", "hosts", "stream", "streaming", "retainer", "livestream"],
    cats: [
      { cat: "📢 START HERE", about: "News, rules and the community chat.", ch: [ch.announcements, ch.rules, ch.welcome, ch.general] },
      { cat: "🔴 LIVE", about: "Everything about going LIVE for the brand.", ch: [
        { e: "🗓️", name: "live-schedule", perm: "read", desc: "Who’s going LIVE and when" },
        { ...ch.wins, e: "🏆", name: "live-wins", desc: "Milestone cards from the bot, and hosts share their best LIVEs" },
        { e: "🎙️", name: "host-tips", perm: "read", desc: "Scripts, offers and how to keep viewers watching" },
        { e: "🎞️", name: "live-replays", perm: "everyone", desc: "Share clips and replays for feedback" } ] },
      { cat: "📈 PERFORMANCE", about: "Rankings and the angles that sold.", ch: [ch.leaderboard, ch.angles] },
      { cat: "💼 RETAINER HOSTS", about: "For paid hosts on a retainer.", ch: [{ e: "💼", name: "retainer-hosts", perm: "everyone", desc: "Briefs, shifts and payment questions" }] },
      MODS([{ e: "", name: "host-applications", perm: "mods", desc: "New host applications to review" }]),
    ],
  },
  {
    id: "vip-ambassadors", icon: "💎", name: "VIP Ambassador Program", tagline: "A tiered program: everyone starts in the lobby, top sellers unlock the VIP lounge, early drops and contests.",
    bestFor: "Brands with tiers, perks and top sellers", keywords: ["vip", "ambassador", "tier", "tiers", "exclusive", "perks", "rewards", "loyalty", "contest", "premium"],
    cats: [
      { cat: "👋 LOBBY", about: "Where every creator starts.", ch: [ch.announcements, ch.rules, ch.welcome, ch.intros, ch.general] },
      { cat: "🌟 AMBASSADORS", about: "The daily tools for every ambassador.", ch: [
        ch.wins, ch.leaderboard, ch.angles, ch.hooks,
        { e: "🎁", name: "ambassador-perks", perm: "read", desc: "Tier rewards, bonuses and how to level up" } ] },
      { cat: "💎 VIP LOUNGE", about: "For top sellers. Lock it to your VIP tier role in Discord after it’s created.", ch: [
        { e: "💎", name: "vip-lounge", perm: "everyone", desc: "Top sellers only: a direct line to the brand" },
        { e: "⚡", name: "exclusive-drops", perm: "read", desc: "New products before anyone else" } ] },
      { cat: "🏅 CONTESTS", about: "Monthly contests to keep the energy up.", ch: [
        { e: "🏅", name: "contests", perm: "read", desc: "This month’s contest, rules and prizes" },
        { e: "📥", name: "contest-entries", perm: "everyone", desc: "Drop your entries here" } ] },
      MODS(),
    ],
  },
];

/** How many channels a template (or a list of categories) has. */
export const channelCount = (cats) => cats.reduce((n, c) => n + c.ch.length, 0);
/** How many automations a template's channels are wired to (the approvals channel isn't an automation). */
export const automationCount = (cats) => new Set(cats.flatMap((c) => c.ch.map((x) => x.auto)).filter((a) => a && a !== "mod")).size;

/** The template whose keywords best match a description, or null when nothing stands out. */
export function suggestTemplate(text) {
  const words = String(text || "").toLowerCase().match(/[a-z]+/g) || [];
  let best = null, top = 0;
  for (const t of TEMPLATES) {
    const score = t.keywords.reduce((n, k) => n + (words.includes(k) ? 1 : 0), 0);
    if (score > top) { best = t; top = score; }
  }
  return top > 0 && best.id !== "creator-community" ? best : null;
}
