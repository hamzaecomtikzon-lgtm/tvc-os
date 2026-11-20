/*
 * Viral hooks: find the niche's most-viewed videos for a week and turn one into
 * frames Claude can look at.
 *
 * Videos come from TikTok Shop as a whole (other brands' products matching the niche
 * words) through Cruva's MCP server. That market data needs Cruva to allow it for the
 * API key; until then, and on sample data, the shop's own most-viewed affiliate videos
 * are used instead.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegStatic from "ffmpeg-static";
import { withCruvaMcp } from "./cruvaMcp.js";

const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const n = (s) => Number(String(s || "0").replace(/[^\d.]/g, "")) || 0;
const NOT_ON_PLAN = /isn.t available on your current plan|enterprise/i;

/** Products in Cruva's market search output: `[{ name, id, gmv, units }]`. */
export function parseProducts(text) {
  const out = [];
  for (const m of text.matchAll(/^(.+?) \(product_id: (\d+)\) - GMV: [^\d]*([\d,.]+) \| Units: ([\d,]+)/gm)) out.push({ name: m[1].trim(), id: m[2], gmv: n(m[3]), units: n(m[4]) });
  return out;
}

/** Videos in Cruva's product-video output: `[{ handle, video_id, gmv, views, likes, comments, posted, product, product_id, link }]`. */
export function parseVideos(text) {
  const out = [];
  const re = /^- @(\S+) \(video_id: (\d+)\) \| GMV: [^\d]*([\d,.]+) \| Views: ([\d,]+) \| Likes: ([\d,]+) \| Comments: ([\d,]+) \| Posted: (\S+)\s*\n\s+Product: (.+?) \(product_id: (\d+)\)\s*\n\s+(https?:\/\/\S+)/gm;
  for (const m of text.matchAll(re)) {
    out.push({ handle: m[1], video_id: m[2], gmv: n(m[3]), views: n(m[4]), likes: n(m[5]), comments: n(m[6]), posted: m[7].slice(0, 10), product: m[8].trim(), product_id: m[9], link: m[10].replace("://tiktok.com", "://www.tiktok.com") });
  }
  return out;
}

/**
 * The niche's videos for the window, most-viewed first, from other sellers on TikTok Shop.
 * Returns null when Cruva doesn't allow market data for this key.
 */
async function marketVideos(call, { niche, region, from, to, ownProducts }) {
  const products = [];
  for (const word of niche.split(",").map((w) => w.trim()).filter(Boolean).slice(0, 3)) {
    const text = await call("search_marketplace_products", { search: word, region, date_from: from, date_to: to, sort: "views", page_size: 10 });
    if (NOT_ON_PLAN.test(text) && !parseProducts(text).length) return null;
    products.push(...parseProducts(text));
    await sleep(600); // market endpoints allow 2 requests a second
  }
  const seen = new Set();
  const picks = products.filter((p) => !ownProducts.has(p.id) && !seen.has(p.id) && seen.add(p.id)).slice(0, 8);
  const videos = [];
  for (const p of picks) {
    const text = await call("list_marketplace_product_videos", { product_id: p.id, region, ts_start: from, ts_end: to, sort: "views", page_size: 5 });
    if (NOT_ON_PLAN.test(text) && !parseVideos(text).length) return null;
    videos.push(...parseVideos(text));
    await sleep(600);
  }
  const ids = new Set();
  return videos.filter((v) => !ids.has(v.video_id) && ids.add(v.video_id)).sort((a, b) => b.views - a.views);
}

/** The shop's own affiliate videos for the window, most-viewed first. */
async function ownVideos(crm, shop, from, to) {
  const { videos } = await crm.searchVideos({ shop_id: shop.id, date_from: from, date_to: to, sort_by: "views", page_size: 25 });
  return videos.filter((v) => v.views > 0).map((v) => ({
    handle: v.handle, video_id: v.video_id, gmv: v.gmv, views: v.views, comments: v.comments || 0, posted: v.post_time,
    product: v.product || v.title, product_id: v.product_id, link: v.video_link, transcript: v.transcript || "", hooks: v.hooks || [], overview: v.content_overview || "",
  }));
}

/**
 * The rank-th (1-based) most-viewed video of the window. `{ video, source }` where source is
 * "market" or "shop", or `{ video: null }`. `apiKey` is the workspace's Cruva key (null on sample data).
 */
export async function pickViral({ crm, shop, niche, from, to, rank, apiKey }) {
  if (apiKey && niche) {
    try {
      const { videos: own } = await crm.searchVideos({ shop_id: shop.id, date_from: from, date_to: to, sort_by: "gmv", page_size: 100 });
      const ownProducts = new Set(own.map((v) => v.product_id).filter(Boolean));
      const list = await withCruvaMcp(apiKey, (call) => marketVideos(call, { niche, region: shop.region || "us", from, to, ownProducts }));
      if (list?.length) return { video: list[rank - 1] || list[list.length - 1], source: "market" };
      if (list === null) console.warn("[viral] Cruva market data isn't enabled for this API key; using the shop's own videos.");
    } catch (e) {
      console.error("[viral] market videos", e.message);
    }
  }
  const list = await ownVideos(crm, shop, from, to);
  return { video: list[rank - 1] || list[list.length - 1] || null, source: "shop" };
}

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => resolve({ code, err }));
  });
}

/**
 * Download a TikTok video through Cruva and cut it into frames: `{ frames: [{ t, jpg }], duration, caption }`,
 * about one frame a second (at most 30). Null when it can't be downloaded.
 */
export async function videoFrames(apiKey, shopId, video) {
  let url, caption = "";
  try {
    const text = await withCruvaMcp(apiKey, (call) => call("get_video_download_url", { shop_id: shopId, video_id: video.video_id, handle: video.handle }));
    url = /https:\/\/\S+?\.mp4\S*/.exec(text)?.[0];
    caption = text.split("\n").slice(1).find((l) => l.trim() && !l.startsWith("http"))?.trim() || "";
  } catch (e) {
    console.error("[viral] download link", e.message);
  }
  if (!url) return null;
  const dir = await mkdtemp(join(tmpdir(), "kreo-viral-"));
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 150 * 1024 * 1024) return null;
    await writeFile(join(dir, "v.mp4"), buf);
    const probe = await run(["-hide_banner", "-i", join(dir, "v.mp4")]);
    const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(probe.err);
    const duration = d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 30;
    const step = Math.max(1, Math.ceil(duration / 30));
    const out = await run(["-hide_banner", "-loglevel", "error", "-i", join(dir, "v.mp4"), "-vf", `fps=1/${step},scale=432:-2`, "-frames:v", "30", "-q:v", "5", join(dir, "f%03d.jpg")]);
    if (out.code !== 0) {
      console.error("[viral] ffmpeg", out.err.slice(0, 300));
      return null;
    }
    const files = (await readdir(dir)).filter((f) => f.endsWith(".jpg")).sort();
    const frames = [];
    for (const [i, f] of files.entries()) frames.push({ t: i * step, jpg: await readFile(join(dir, f)) });
    return { frames, duration: Math.round(duration), caption };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
