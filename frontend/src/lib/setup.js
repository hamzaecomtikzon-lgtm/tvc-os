/* Content and helpers for the first-run setup (bot → channels → CRM). */
export const STEPS = [
  { n: 1, t: "Add your bot", s: "Name, picture, server" },
  { n: 2, t: "Pick channels", s: "One per automation" },
  { n: 3, t: "Connect your CRM", s: "Cruva, Euka or Reacher" },
];

/** What each channel slot is for. "mod" is the approvals channel; the rest are automation keys. */
export const SLOTS = [
  { key: "mod", name: "Approvals", what: "Private. Every draft lands here for your mods first.", req: true, hint: ["moderator-only", "mod-approvals", "approvals", "moderators", "mods"] },
  { key: "general_chat", name: "General chat manager", what: "Replies to creators in your voice. Risky topics go to mods.", hint: ["general-chat", "general"] },
  { key: "viral_hooks", name: "Viral hooks", what: "The niche’s most-viewed videos from last week, one a day, with how to remake the hook.", hint: ["viral-hooks-and-ideas", "viral-hooks", "viral"] },
  { key: "winning_content", name: "Winning angle of the week", what: "Last week’s top 3 videos by GMV, one a day: numbers, script and how to replicate it.", hint: ["winning-angles", "winning"] },
  { key: "wins", name: "Creator wins", what: "A milestone card the first time a creator hits their 1st, 3rd, 10th, 30th or 50th sale.", hint: ["share-wins", "creator-wins", "wins"] },
  { key: "leaderboard", name: "Weekly leaderboard", what: "Monday podium card: top 5 creators by GMV for last Sun–Sat.", hint: ["leaderboard"] },
  { key: "onboarding", name: "Creator onboarding", what: "DMs each new member your questions, links their TikTok and saves the answers.", hint: ["welcome", "introductions"] },
];
export const slotName = (key) => SLOTS.find((s) => s.key === key)?.name || "";

export const PERMS = { everyone: "Everyone can chat", read: "Read-only (bot posts)", mods: "Mods only" };

/** Community template: emoji・name channels in the creator-community layout. */
export const TEMPLATE = [
  { cat: "👋 GET STARTED", about: "First stop for every new creator: what this is, the rules, and where to say hi.", ch: [
    { e: "📢", name: "announcements", perm: "read", desc: "Launches, promos and commission changes" },
    { e: "📌", name: "rules", perm: "read", desc: "Community guidelines and posting rules" },
    { e: "👋", name: "welcome", perm: "read", desc: "Bot welcome and how the community works", auto: "onboarding" },
    { e: "🙋", name: "introductions", perm: "everyone", desc: "New creators say hi and drop their TikTok" },
    { e: "💬", name: "general-chat", perm: "everyone", desc: "Day-to-day chat, answered by your bot", auto: "general_chat" },
    { e: "📊", name: "leaderboard", perm: "read", desc: "Monday top 5 creators by GMV", auto: "leaderboard" } ] },
  { cat: "🌟 CREATOR HUB", about: "Everything that helps creators sell: wins, winning angles, hooks, briefs and links.", ch: [
    { e: "🏆", name: "share-wins", perm: "everyone", desc: "Milestone cards from the bot, and creators share their own wins", auto: "wins" },
    { e: "🔥", name: "winning-angles", perm: "read", desc: "Last week’s top videos by GMV, broken down", auto: "winning_content" },
    { e: "🎥", name: "video-feedback", perm: "everyone", desc: "Creators post drafts and get feedback" },
    { e: "📷", name: "viral-hooks-and-ideas", perm: "read", desc: "The niche’s most-viewed hooks and how to use them", auto: "viral_hooks" },
    { e: "📝", name: "content-briefs", perm: "read", desc: "Your creator brief and talking points" },
    { e: "🔗", name: "affiliate-links", perm: "read", desc: "Product links and sample request steps" } ] },
  { cat: "❓ SUPPORT", about: "Private help for samples, payouts and problems.", ch: [
    { e: "🎫", name: "open-a-ticket", perm: "everyone", desc: "Opens a private ticket with your team" } ] },
  { cat: "📹 MULTI PLATFORM", about: "For creators who also post on Instagram and Facebook.", ch: [
    { e: "📱", name: "meta-creators", perm: "everyone", desc: "Meta programs, Reels tips and cross-posting" } ] },
  { cat: "🔒 MODERATORS", about: "Hidden from creators. Only your mods and the bot can see it.", priv: true, ch: [
    { e: "", name: "moderator-only", perm: "mods", desc: "Every draft waits here for approval", auto: "mod" } ] },
];
export const MOD_CATEGORY = "🔒 MODERATORS";

export const CRMS = [
  { id: "cruva", name: "Cruva", mono: "C", reads: "Creators, videos, orders, samples, Discord links", how: "Create an API key in your Cruva account settings and paste it here." },
  { id: "euka", name: "Euka", mono: "E", reads: "Creators, videos, programs, samples", how: "Create an API key in your Euka workspace settings and paste it here." },
  { id: "reacher", name: "Reacher", mono: "R", reads: "Creators, outreach, samples, orders", how: "Create an API key in your Reacher account settings and paste it here." },
];
export const CRM_CHECKS = ["Checking your key", "Finding your TikTok Shop", "Reading creators, emails and phone numbers", "Reading videos and sales"];

/** Channel name without its emoji prefix: "🏆・share-wins" → "share-wins". */
export const baseName = (n) => String(n).replace(/^.*・/, "").replace(/^[^a-z0-9]+/i, "").toLowerCase();
export const templateLabel = (x) => (x.e ? x.e + "・" : "") + x.name;
export const cleanChannelName = (v) => v.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-_]/g, "").slice(0, 40);

/** Fill empty slots (or all of them with `force`) with the channel whose name fits. Returns a new map of slot → channel id. */
export function autoMatch(channels, map = {}, force = false) {
  const next = force ? {} : { ...map };
  for (const s of SLOTS) {
    if (next[s.key]) continue;
    const hit = s.hint.map((h) => channels.find((c) => baseName(c.name) === h)).find(Boolean);
    if (hit) next[s.key] = hit.id;
  }
  return next;
}

/** Resize a picked image to a 160px square JPEG data URL. */
export function readAvatar(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = c.height = 160;
        const s = Math.min(img.width, img.height);
        c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 160, 160);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
