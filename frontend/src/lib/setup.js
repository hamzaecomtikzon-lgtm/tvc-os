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
  { key: "wins", name: "Creator wins", what: "A milestone card the first time a creator hits their 1st, 3rd, 10th, 30th or 50th sale.", hint: ["share-wins", "creator-wins", "live-wins", "wins"] },
  { key: "leaderboard", name: "Weekly leaderboard", what: "Monday podium card: top 5 creators by GMV for last Sun–Sat.", hint: ["leaderboard"] },
  { key: "onboarding", name: "Creator onboarding", what: "DMs each new member your questions, links their TikTok and saves the answers.", hint: ["welcome", "introductions"] },
];
export const slotName = (key) => SLOTS.find((s) => s.key === key)?.name || "";

export const PERMS = { everyone: "Everyone can chat", read: "Read-only (bot posts)", mods: "Mods only" };

/** The community layouts live in communityTemplates.js; the first is the default. */
export { TEMPLATES } from "./communityTemplates.js";
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

/** Load a picked file (or a data URL) as an image, with friendly errors. */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const open = (url) => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file isn’t an image we can read. Use a PNG, JPG, WebP or SVG."));
      img.onload = () => resolve(img);
      img.src = url;
    };
    if (typeof src === "string") return open(src);
    if (src.size > 8 * 1024 * 1024) return reject(new Error("That image is over 8 MB. Use a smaller logo file."));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn’t read that file."));
    reader.onload = () => open(reader.result);
    reader.readAsDataURL(src);
  });
}

/** The image's own size (SVGs without one get 400×400). */
export const imageSize = (img) => ({ w: img.naturalWidth || 400, h: img.naturalHeight || 400 });

/**
 * The company logo from an image and an optional crop `{ x, y, w, h }` (in the image's pixels): scaled to fit
 * 400×400, never stretched, PNG so transparent backgrounds stay transparent (very detailed images fall back
 * to JPEG on white to keep the workspace small). Resolves `{ logo, w, h }`.
 */
export function logoFromImage(img, crop) {
  const { w: iw, h: ih } = imageSize(img);
  const r = crop || { x: 0, y: 0, w: iw, h: ih };
  const k = Math.min(1, 400 / Math.max(r.w, r.h));
  const w = Math.max(1, Math.round(r.w * k)), h = Math.max(1, Math.round(r.h * k));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, w, h);
  let logo = c.toDataURL("image/png");
  if (logo.length > 350_000) {
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    logo = c.toDataURL("image/jpeg", 0.9);
  }
  return { logo, w, h };
}

/**
 * The part of the image that isn't empty: transparent or near-white edges trimmed away, with a little
 * breathing room. Returns a crop `{ x, y, w, h }` in the image's pixels (the whole image if nothing to trim).
 */
export function contentBounds(img) {
  const { w: iw, h: ih } = imageSize(img);
  const k = Math.min(1, 300 / Math.max(iw, ih)); // scan a small copy: fast, and precise enough for a crop box
  const w = Math.max(1, Math.round(iw * k)), h = Math.max(1, Math.round(ih * k));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  let px;
  try {
    px = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return { x: 0, y: 0, w: iw, h: ih };
  }
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const empty = px[i + 3] < 24 || (px[i] > 242 && px[i + 1] > 242 && px[i + 2] > 242);
      if (empty) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w: iw, h: ih };
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  return { x: Math.round(x0 / k), y: Math.round(y0 / k), w: Math.min(iw, Math.round((x1 - x0 + 1) / k)), h: Math.min(ih, Math.round((y1 - y0 + 1) / k)) };
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
