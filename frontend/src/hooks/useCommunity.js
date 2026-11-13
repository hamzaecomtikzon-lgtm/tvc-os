import { useMemo } from "react";
import { useApp } from "../context/app.js";
import { db } from "../services/db.js";
import { commMetrics } from "../lib/community.js";
import { useCruva } from "./useCruva.js";

/**
 * Discord members (bots left out) with what onboarding learned about them,
 * the activity the bot has counted, and the community metrics for the range.
 */
export function useCommunity() {
  const { v, gid, members, dms, range, scoring } = useApp();
  return useMemo(() => {
    const threads = Object.fromEntries(dms.map((t) => [t.userId, t]));
    const list = (members?.list || []).filter((m) => !m.bot).map((m) => ({
      ...m, tiktok: threads[m.id]?.tiktok || "", linked: !!threads[m.id]?.tiktok, thread: threads[m.id] || null,
    }));
    const activity = db.list("activity", (d) => d.guild === gid);
    const M = commMetrics({ members: list, activity }, scoring, range.from, range.to);
    const byId = Object.fromEntries(list.map((m) => [m.id, m]));
    return { members: list.filter((m) => !m.left), everyone: list, byId, activity, M, tracking: activity.length > 0, listed: members?.allowed !== false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, gid, range.from, range.to]);
}

/**
 * One row per creator: everyone in the CRM, plus Discord members the CRM doesn't know.
 * A member is linked to a CRM creator by the TikTok handle they gave in onboarding.
 */
export function useCreators() {
  const { shop, range, cfg } = useApp();
  const { members, M } = useCommunity();
  const { data, loading, error } = useCruva("listCreators", { shop_id: shop?.id, date_from: range.from, date_to: range.to }, !!shop);
  const rows = useMemo(() => {
    const stats = Object.fromEntries(M.board.map((u) => [u.id, u]));
    const byHandle = {};
    members.forEach((m) => { if (m.tiktok) byHandle[m.tiktok] = m; });
    const row = (c, m) => {
      const dmWa = cfg.waDetect !== false ? m?.thread?.wa || "" : "";
      const s = m ? stats[m.id] : null;
      return {
        key: c ? "c:" + c.handle : "m:" + m.id, handle: c?.handle || m?.tiktok || "", name: c?.name || m?.name || "",
        email: c?.email || "", phone: c?.phone || "", wa: dmWa || c?.whatsapp || "", waSrc: dmWa ? "dm" : c?.whatsapp ? "crm" : "",
        gmv: c?.gmv || 0, sales: c?.sales || 0, videos: c?.videos || 0, views: c?.views || 0, inCrm: !!c,
        member: m || null, msgs: s?.m || 0, activeDays: s?.ad || 0, engaged: (s?.ad || 0) >= 3, joined: m?.joined || "",
      };
    };
    const out = (data || []).map((c) => row(c, byHandle[c.handle] || null));
    const known = new Set((data || []).map((c) => c.handle));
    members.forEach((m) => { if (!m.tiktok || !known.has(m.tiktok)) out.push(row(null, m)); });
    return out;
  }, [data, members, M, cfg.waDetect]);
  return { rows, loading, error };
}
