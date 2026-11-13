/*
 * CRM data (TikTok Shop analytics). Serves deterministic sample data for now;
 * replace the bodies with real Cruva / Euka / Reacher API calls and keep the
 * returned shapes, and the dashboard needs no changes.
 */
import { HANDLES, MEMBERS, SHOPS, STAT_LABELS, dayStats, lifeFraction, rangeStat, videoPool } from "./sampleData.js";
import { hash } from "./rng.js";
import { addDays, dateList, daysBetween, todayUTC, ymd } from "./dates.js";

const shopOrThrow = (id) => {
  if (!SHOPS.some((s) => s.id === id)) throw Object.assign(new Error("Unknown shop"), { status: 404, code: "tool_error" });
};
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const rangeOrThrow = (from, to) => {
  if (!isDate(from) || !isDate(to) || from > to || daysBetween(from, to) > 400) throw Object.assign(new Error("Bad date range"), { status: 400, code: "tool_error" });
};

export const crm = {
  listShops() {
    return SHOPS.map((s) => ({ ...s }));
  },

  getShopStats({ shop_id, date_from, date_to, stats = [], include_charts }) {
    shopOrThrow(shop_id);
    rangeOrThrow(date_from, date_to);
    const len = daysBetween(date_from, date_to) + 1;
    const pTo = ymd(addDays(date_from, -1));
    const pFrom = ymd(addDays(date_from, -len));
    const out = {};
    for (const k of stats) {
      if (!STAT_LABELS[k]) continue;
      const v = rangeStat(shop_id, k, date_from, date_to);
      const prev = rangeStat(shop_id, k, pFrom, pTo);
      const p = prev ? ((v - prev) / prev) * 100 : null;
      out[k] = {
        label: STAT_LABELS[k],
        v,
        dir: p == null ? null : p >= 0 ? "up" : "down",
        pct: p == null ? null : Math.abs(p),
        series: include_charts ? dateList(date_from, date_to).map((date) => ({ date, v: dayStats(shop_id, date)[k] })) : [],
      };
    }
    return out;
  },

  searchVideos({ shop_id, date_from, date_to, sort_by = "gmv", page_size = 25, page_number = 1, handle }) {
    shopOrThrow(shop_id);
    rangeOrThrow(date_from, date_to);
    const h = String(handle || "").toLowerCase();
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
    const size = Math.min(Math.max(1, page_size | 0), 100);
    const start = (Math.max(1, page_number | 0) - 1) * size;
    return { videos: rows.slice(start, start + size), more: rows.length > start + size };
  },

  /**
   * Every creator the CRM knows, with contact details and what they sold in the range.
   * Sample contacts use example.com addresses and 555 numbers.
   */
  listCreators({ shop_id, date_from, date_to }) {
    shopOrThrow(shop_id);
    rangeOrThrow(date_from, date_to);
    const by = Object.fromEntries(HANDLES.map((h) => [h, { gmv: 0, sales: 0, videos: 0, views: 0 }]));
    for (const v of videoPool(shop_id)) {
      const f = lifeFraction(v.post_date, date_from, date_to);
      if (f <= 0) continue;
      const t = by[v.handle];
      t.gmv += v.base.gmv * f;
      t.sales += Math.max(1, Math.round((v.base.gmv * f) / v.base.price));
      t.views += Math.round(v.base.views * f);
      if (v.post_date >= date_from && v.post_date <= date_to) t.videos++;
    }
    return HANDLES.map((handle) => {
      const n = hash("contact" + handle);
      const first = handle.split(/[._]/)[0];
      const digits = String(1000 + (n % 9000));
      return {
        handle,
        name: first[0].toUpperCase() + first.slice(1) + " " + "ABCDEFGHJKLMNPRSTW"[n % 18] + ".",
        email: handle.replace(/[^a-z0-9]/g, "") + "@example.com",
        phone: n % 3 ? `+1 (${[305, 213, 646, 512, 786, 470][n % 6]}) 555-${digits}` : null,
        whatsapp: n % 5 === 0 ? `+1 ${[305, 213, 646, 512, 786, 470][n % 6]} 555 ${digits}` : null,
        gmv: Math.round(by[handle].gmv * 100) / 100, sales: by[handle].sales, videos: by[handle].videos, views: by[handle].views,
      };
    }).sort((a, b) => b.gmv - a.gmv);
  },

  /** GMV and orders per product in the range. */
  topProducts({ shop_id, date_from, date_to }) {
    shopOrThrow(shop_id);
    rangeOrThrow(date_from, date_to);
    const by = {};
    for (const v of videoPool(shop_id)) {
      const f = lifeFraction(v.post_date, date_from, date_to);
      if (f <= 0) continue;
      const t = by[v.product] || (by[v.product] = { name: v.product, gmv: 0, orders: 0 });
      t.gmv += v.base.gmv * f;
      t.orders += Math.max(1, Math.round((v.base.gmv * f) / v.base.price));
    }
    return Object.values(by).map((p) => ({ ...p, gmv: Math.round(p.gmv * 100) / 100 })).sort((a, b) => b.gmv - a.gmv);
  },

  listDiscordMembers({ shop_id, page = 1, page_size = 100 }) {
    shopOrThrow(shop_id);
    const all = MEMBERS.map(({ id, user, display, tiktok, linked, roles, joined }) => ({ id, user, display, tiktok, linked, roles: roles.length, joined }));
    const linked = all.filter((m) => m.linked).length;
    const size = Math.min(Math.max(1, page_size | 0), 100);
    const start = (Math.max(1, page | 0) - 1) * size;
    return {
      header: { members: all.length, linked, unlinked: all.length - linked, synced: ymd(todayUTC()) },
      members: all.slice(start, start + size),
      more: all.length > start + size,
    };
  },
};
