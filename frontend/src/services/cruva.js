/*
 * CRM data (TikTok Shop analytics), served by the backend (backend/src/crm.js).
 * Every call resolves the tool's data or rejects with an Error carrying `code`.
 */
import { api } from "./api.js";

const tool = (name) => async (input = {}) => (await api("POST", "/crm/" + name, input)).data;

export const cruva = {
  /** @returns {Promise<Array<{name,id,plan,region}>>} */
  listShops: tool("listShops"),
  /** @returns {Promise<Record<string,{label,v,dir,pct,series}>>} */
  getShopStats: tool("getShopStats"),
  /** @returns {Promise<{videos:Array, more:boolean}>} */
  searchVideos: tool("searchVideos"),
  /** Every creator in the CRM with contact details and sales in the range. */
  listCreators: tool("listCreators"),
  /** GMV and orders per product. */
  topProducts: tool("topProducts"),
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
