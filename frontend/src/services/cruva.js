/*
 * Cruva API client (TikTok Shop analytics). This build serves deterministic demo
 * data with realistic latency; replace the bodies with real API calls and keep
 * the returned shapes.
 */
import { MEMBERS, SHOPS, STAT_LABELS, dayStats, lifeFraction, rangeStat, videoPool } from "./mockData.js";
import { addDays, daysBetween, dateList, todayUTC, ymd } from "../lib/format.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms + Math.random() * ms));
const notFound = () => Object.assign(new Error("Unknown shop"), { code: "tool_error" });
const shopExists = (id) => SHOPS.some((s) => s.id === id);

export const cruva = {
  /** @returns {Promise<Array<{name,id,plan,region}>>} */
  async listShops() {
    await wait(120);
    return SHOPS.map((s) => ({ ...s }));
  },

  /** @returns {Promise<Record<string,{label,v,dir,pct,series}>>} */
  async getShopStats({ shop_id, date_from, date_to, stats, include_charts }) {
    await wait(220);
    if (!shopExists(shop_id)) throw notFound();
    const len = daysBetween(date_from, date_to) + 1;
    const pTo = ymd(addDays(date_from, -1));
    const pFrom = ymd(addDays(date_from, -len));
    const out = {};
    for (const k of stats) {
      const v = rangeStat(shop_id, k, date_from, date_to);
      const prev = rangeStat(shop_id, k, pFrom, pTo);
      const p = prev ? ((v - prev) / prev) * 100 : null;
      out[k] = {
        label: STAT_LABELS[k] || k,
        v,
        dir: p == null ? null : p >= 0 ? "up" : "down",
        pct: p == null ? null : Math.abs(p),
        series: include_charts ? dateList(date_from, date_to).map((date) => ({ date, v: dayStats(shop_id, date)[k] })) : [],
      };
    }
    return out;
  },

  /** @returns {Promise<{videos:Array, more:boolean}>} */
  async searchVideos({ shop_id, date_from, date_to, sort_by = "gmv", page_size = 25, page_number = 1, handle }) {
    await wait(260);
    if (!shopExists(shop_id)) throw notFound();
    const h = (handle || "").toLowerCase();
    const rows = [];
    for (const v of videoPool(shop_id)) {
      if (h && !v.handle.toLowerCase().includes(h)) continue;
      const f = lifeFraction(v.post_date, date_from, date_to);
      if (f <= 0) continue;
      const b = v.base;
      const gmv = Math.round(b.gmv * f * 100) / 100;
      const ads = b.unknown ? null : Math.round(gmv * b.adsShare * 100) / 100;
      rows.push({
        video_id: v.video_id, handle: v.handle, title: v.title, content_overview: v.content_overview,
        post_time: v.post_date, hooks: v.hooks, video_link: v.video_link,
        gmv, units_sold: Math.max(1, Math.round(gmv / b.price)), views: Math.round(b.views * f),
        ads_gmv: ads, roi: b.unknown || !b.hasAds ? null : ads / (b.spend * f),
      });
    }
    rows.sort((a, b) => (b[sort_by] ?? -1) - (a[sort_by] ?? -1));
    const start = (page_number - 1) * page_size;
    return { videos: rows.slice(start, start + page_size), more: rows.length > start + page_size };
  },

  /** Discord members known to Cruva, with TikTok links. */
  async listDiscordMembers({ shop_id, page = 1, page_size = 100 }) {
    await wait(200);
    if (!shopExists(shop_id)) throw notFound();
    const all = MEMBERS.map(({ id, user, display, tiktok, linked, roles, joined }) => ({ id, user, display, tiktok, linked, roles: roles.length, joined }));
    const linked = all.filter((m) => m.linked).length;
    const start = (page - 1) * page_size;
    return {
      header: { members: all.length, linked, unlinked: all.length - linked, synced: ymd(todayUTC()) },
      members: all.slice(start, start + page_size),
      more: all.length > start + page_size,
    };
  },
};

/* ---------- cached calls (stale-while-revalidate is handled by the hook) ---------- */
const cache = new Map();
export const cacheKey = (tool, input) => tool + ":" + JSON.stringify(input);
export const cached = (key) => cache.get(key);
export async function callCached(tool, input) {
  const key = cacheKey(tool, input);
  if (cache.has(key)) return cache.get(key);
  const data = await cruva[tool](input);
  cache.set(key, data);
  return data;
}
export function invalidateCruva() {
  cache.clear();
}
