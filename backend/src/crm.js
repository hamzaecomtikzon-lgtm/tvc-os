/*
 * CRM data (TikTok Shop analytics). With CRUVA_API_KEY set in backend/.env every
 * call reads the live Cruva API (https://cruva.com/docs/api); without it the
 * deterministic sample data below is served, in the same shapes.
 */
import { HANDLES, MEMBERS, SHOPS, STAT_LABELS, dayStats, lifeFraction, rangeStat, videoPool } from "./sampleData.js";
import { hash } from "./rng.js";
import { addDays, dateList, daysBetween, todayUTC, ymd } from "./dates.js";
import { store } from "./store.js";

const shopOrThrow = (id) => {
  if (!SHOPS.some((s) => s.id === id)) throw Object.assign(new Error("Unknown shop"), { status: 404, code: "tool_error" });
};
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const rangeOrThrow = (from, to) => {
  if (!isDate(from) || !isDate(to) || from > to || daysBetween(from, to) > 400) throw Object.assign(new Error("Bad date range"), { status: 400, code: "tool_error" });
};

const sample = {
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

/* ---------------------------------------------------------------- Cruva (live) */

const CRUVA = "https://api.cruva.com";
const TTL = 5 * 60_000;
const cache = new Map(); // request key → { at, value: Promise }
const toolError = (message, status = 502) => Object.assign(new Error(message), { status, code: "tool_error" });

/** One Cruva request. Retries once on a rate limit; caches successful reads for a few minutes. */
async function cruva(method, path, { shop, body } = {}) {
  const key = method + path + (shop || "") + JSON.stringify(body || "");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = (async () => {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(CRUVA + path, {
          method,
          headers: { "x-api-key": process.env.CRUVA_API_KEY, ...(shop ? { "x-shop-id": shop } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(60_000),
        });
      } catch (e) {
        if (attempt < 1) continue; // one retry on a dropped connection
        console.error(`[cruva] ${method} ${path} → network error: ${e.cause?.code || e.message}`);
        throw toolError("Couldn’t reach Cruva. Try again in a moment.");
      }
      if (res.status === 429 && attempt < 2) { await new Promise((r) => setTimeout(r, 1200 * (attempt + 1))); continue; }
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const why = json?.error?.message || json?.message || json?.detail || res.statusText;
        console.error(`[cruva] ${method} ${path} → ${res.status}: ${typeof why === "string" ? why : JSON.stringify(why)}`);
        if (res.status === 401) throw toolError("Cruva rejected the API key. Check CRUVA_API_KEY on the server.");
        if (res.status === 403) throw toolError("This Cruva API key isn’t allowed to read that shop or data.");
        throw toolError("Cruva returned an error. Try again in a moment.");
      }
      return json;
    }
  })();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return value;
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const r2 = (v) => Math.round(num(v) * 100) / 100;
/** Cruva video dates come as MM/DD/YYYY; the app uses YYYY-MM-DD. */
const isoDate = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s || "");
  return m ? `${m[3]}-${m[1]}-${m[2]}` : String(s || "").slice(0, 10);
};
/** App stat key → Cruva stat key, where they differ. */
const STAT_KEY = { orders: "platform_orders" };

let shopList = null; // { at, value }
async function liveShops() {
  if (shopList && Date.now() - shopList.at < TTL) return shopList.value;
  const { data = [] } = await cruva("GET", "/account/shops");
  const pinned = process.env.CRUVA_SHOP_ID;
  let rows = data.filter((s) => s.is_active || s.shop_id === pinned);
  if (!rows.length) rows = data;
  rows.sort((a, b) => (b.shop_id === pinned) - (a.shop_id === pinned) || a.shop_name.localeCompare(b.shop_name));
  const value = rows.map((s) => ({ name: s.shop_name, id: s.shop_id, plan: s.plan ? s.plan[0].toUpperCase() + s.plan.slice(1) : "", region: s.region || "us" }));
  shopList = { at: Date.now(), value };
  return value;
}
async function liveShopOrThrow(id) {
  if (!(await liveShops()).some((s) => s.id === id)) throw toolError("Unknown shop", 404);
}

/** Page through a Cruva list until it runs out (or `max` pages), `batch` pages at a time. */
async function pages(fetchPage, { size = 100, max = 10, batch = 3 } = {}) {
  const all = [];
  for (let n = 1; n <= max; n += batch) {
    const got = await Promise.all(Array.from({ length: Math.min(batch, max - n + 1) }, (_, i) => fetchPage(n + i, size)));
    for (const { rows } of got) all.push(...rows);
    const last = got[got.length - 1];
    if (got.some(({ rows }) => rows.length < size) || !(last.more ?? last.rows.length === size)) break;
  }
  return all;
}

const live = {
  listShops: liveShops,

  async getShopStats({ shop_id, date_from, date_to, stats = [], include_charts }) {
    await liveShopOrThrow(shop_id);
    rangeOrThrow(date_from, date_to);
    const want = stats.filter((k) => typeof k === "string" && /^[a-z_]{1,60}$/.test(k));
    if (!want.length) return {};
    const { data } = await cruva("POST", "/shop/stats", {
      shop: shop_id,
      body: { date_range: { from: date_from, to: date_to }, include_charts: !!include_charts, stats: want.map((k) => STAT_KEY[k] || k) },
    });
    const by = Object.fromEntries((data?.stats || []).map((s) => [s.key, s]));
    const out = {};
    for (const k of want) {
      const s = by[STAT_KEY[k] || k];
      if (!s) continue;
      const p = typeof s.percent_change === "number" ? s.percent_change : null;
      out[k] = {
        label: STAT_LABELS[k] || s.title,
        v: num(s.total_count),
        dir: p == null ? null : p >= 0 ? "up" : "down",
        pct: p == null ? null : Math.abs(p),
        series: include_charts ? (s.daily_counts || []).map((d) => ({ date: d.date, v: num(d.count) })) : [],
      };
    }
    return out;
  },

  async searchVideos({ shop_id, date_from, date_to, sort_by = "gmv", page_size = 25, page_number = 1, handle }) {
    await liveShopOrThrow(shop_id);
    rangeOrThrow(date_from, date_to);
    const size = Math.min(Math.max(1, page_size | 0), 100);
    // The windowed endpoint: GMV and views earned during the range (not videos posted in it).
    const j = await cruva("POST", "/timeseries/videos", {
      shop: shop_id,
      body: {
        page_size: size, page_number: Math.max(1, page_number | 0),
        search_params: { date_range: { from: date_from, to: date_to }, sort_by: ["gmv", "views", "units_sold"].includes(sort_by) ? sort_by : "gmv", sort_direction: "DESC", ...(handle ? { handle: String(handle) } : {}) },
      },
    });
    const rows = j.data || [];
    const videos = rows.map((v) => ({
      video_id: v.video_id, handle: v.handle, title: v.title || "", content_overview: v.content_overview || "",
      post_time: isoDate(v.post_time), hooks: Array.isArray(v.hooks) ? v.hooks : [],
      video_link: v.video_link || v.video_url || `https://www.tiktok.com/@${v.handle}/video/${v.video_id}`,
      gmv: r2(v.gmv), units_sold: num(v.units_sold), views: num(v.views ?? v.view_count),
      ads_gmv: v.ads_gmv == null ? null : r2(v.ads_gmv),
      roi: num(v.ad_spend) > 0 ? num(v.ads_gmv) / v.ad_spend : null,
    }));
    return { videos, more: j.has_more ?? rows.length === size };
  },

  /** Creators with sales in the range (from Cruva's time series) joined with contact details from the Cruva CRM. */
  async listCreators({ shop_id, date_from, date_to }) {
    await liveShopOrThrow(shop_id);
    rangeOrThrow(date_from, date_to);
    const [sales, contacts] = await Promise.all([
      pages(async (n, size) => {
        const j = await cruva("POST", "/timeseries/affiliates", { shop: shop_id, body: { page_size: size, page_number: n, search_params: { date_range: { from: date_from, to: date_to }, sort_by: "gmv", sort_direction: "DESC" } } });
        return { rows: j.data || [], more: j.has_more };
      }),
      pages(async (n, size) => {
        const j = await cruva("POST", "/affiliate/crm/list", { shop: shop_id, body: { page_size: size, page_number: n, sort_by: "gmv", sort_direction: "DESC" } });
        return { rows: j.results || j.data?.results || [], more: j.has_more ?? j.data?.has_more };
      }, { max: 5 }), // contact details for the 500 creators with the most GMV; more would be slow to load
    ]);
    const by = new Map();
    const row = (handle, nickname) => {
      if (!by.has(handle)) by.set(handle, { handle, name: nickname || handle, email: "", phone: null, whatsapp: null, gmv: 0, sales: 0, videos: 0, views: 0 });
      return by.get(handle);
    };
    for (const c of contacts) {
      if (!c.handle) continue;
      const r = row(c.handle, c.nickname);
      r.email = c.email || "";
      r.phone = c.phone_number || null;
    }
    for (const a of sales) {
      if (!a.handle) continue;
      const r = row(a.handle, a.nickname);
      Object.assign(r, { gmv: r2(a.gmv), sales: num(a.units_sold), videos: num(a.video_count), views: num(a.views) });
    }
    return [...by.values()].sort((a, b) => b.gmv - a.gmv);
  },

  /** GMV and units sold per product in the range. */
  async topProducts({ shop_id, date_from, date_to }) {
    await liveShopOrThrow(shop_id);
    rangeOrThrow(date_from, date_to);
    const { data = [] } = await cruva("POST", "/timeseries/products", {
      shop: shop_id,
      body: { page_size: 100, page_number: 1, search_params: { date_range: { from: date_from, to: date_to }, sort_by: "total_gmv", sort_direction: "DESC" } },
    });
    return data.filter((p) => num(p.total_gmv) > 0).map((p) => ({ name: p.product_name, gmv: r2(p.total_gmv), orders: num(p.units_sold) }));
  },

  // Discord membership isn't CRM data; it stays on the sample until it's built from the bot's own member list.
  listDiscordMembers: (input) => sample.listDiscordMembers({ ...input, shop_id: SHOPS[0].id }),
};

/*
 * The Cruva key is one server-wide credential, so live data goes only to workspaces whose
 * owner's email is in CRUVA_ALLOWED_EMAILS (comma-separated; team members share their
 * owner's workspace). Every other sign-up sees the sample data.
 */
const allowed = () => new Set(String(process.env.CRUVA_ALLOWED_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
const isLive = (ns) => Boolean(process.env.CRUVA_API_KEY && ns && allowed().has(String(store.owner(ns)?.email || "").toLowerCase()));
if (process.env.CRUVA_API_KEY && !allowed().size) console.warn("[cruva] CRUVA_API_KEY is set but CRUVA_ALLOWED_EMAILS is empty, so every workspace sees sample data.");

const wrap = (impl) => Object.fromEntries(Object.keys(sample).map((name) => [name, async (input = {}) => impl[name](input)]));
const LIVE = wrap(live), SAMPLE = wrap(sample);

/** The CRM tools for a workspace. Every tool resolves its data (a Promise either way). */
export const crmFor = (ns) => (isLive(ns) ? LIVE : SAMPLE);

/** Where a workspace's data comes from, for labels: "cruva" or "sample". */
export const crmSource = (ns) => (isLive(ns) ? "cruva" : "sample");

/** The workspace's shop object for an id (falls back to its first shop). */
export async function shopFor(ns, id) {
  const list = await crmFor(ns).listShops();
  return list.find((s) => s.id === id) || list[0] || null;
}
