import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db, useDb } from "../services/db.js";
import { cruva, invalidateCruva } from "../services/cruva.js";
import { LIVE_LINK, ask } from "../services/bridge.js";
import { AppCtx } from "./app.js";
import {
  AUTOS, DEFAULT_BOT, DEFAULT_TONE, HOME_GUILD, defaultAutos, defaultOb, defaultScoring, guessChannel, mergeAutos,
} from "../lib/constants.js";
import { moneyFormatter, presetRange } from "../lib/format.js";

const EMPTY = [];
const WS_DEFAULT = { guildId: "", shopId: "", done: false };

export function AppProvider({ children }) {
  const v = useDb();
  const [booted, setBooted] = useState(false);
  const [shops, setShops] = useState(EMPTY);
  const [shopId, setShopId] = useState(null);
  const [cruvaOk, setCruvaOk] = useState(null);
  const [range, setRangeState] = useState(() => presetRange("7"));
  const [refreshKey, setRefreshKey] = useState(0);
  const [toastMsg, setToastMsg] = useState("");
  const toastTimer = useRef(0);

  const toast = useCallback((t) => {
    setToastMsg(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), 3200);
  }, []);

  /* ---------- boot: brands from Cruva ---------- */
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const list = await cruva.listShops();
        if (!live) return;
        setShops(list);
        setCruvaOk(true);
        let saved = null;
        try { saved = localStorage.getItem("tvc.shop"); } catch { /* storage blocked */ }
        const w = db.get("workspace/main");
        const pick = list.find((s) => s.id === saved) || list.find((s) => s.id === w?.shopId) || list[0];
        setShopId(pick ? pick.id : null);
      } catch {
        if (live) setCruvaOk(false);
      }
      if (live) setBooted(true);
    })();
    return () => { live = false; };
  }, []);

  /* ---------- workspace state derived from the store ---------- */
  const derived = useMemo(() => {
    const ws = db.get("workspace/main") || WS_DEFAULT;
    const gid = ws.guildId;
    const guilds = db.list("discord", (g) => g.guildId === HOME_GUILD);
    const guild = guilds.find((g) => g.guildId === gid) || null;
    const channels = guild?.channels || EMPTY;
    if (!gid) {
      return {
        ws, gid, guilds, guild, channels,
        cfg: { botName: DEFAULT_BOT, tone: "", modChannel: "", approverRole: "" },
        autos: defaultAutos(channels), ob: defaultOb(), scoring: defaultScoring(), allow: null,
        drafts: EMPTY, building: EMPTY,
      };
    }
    const cfg = {
      botName: guild?.botName || DEFAULT_BOT, tone: DEFAULT_TONE,
      modChannel: guessChannel(channels, ["moderator-only", "moderator"]), approverRole: "",
      ...(db.get("config/" + gid) || {}),
    };
    const autosDoc = db.get("automations/" + gid);
    const autos = autosDoc?.items ? mergeAutos(defaultAutos(channels), autosDoc.items) : defaultAutos(channels);
    const ob = { ...defaultOb(), ...(db.get("onboarding/" + gid) || {}) };
    const scoring = { ...defaultScoring(), ...(db.get("scoring/" + gid) || {}) };
    const allow = db.get("allowlist/" + gid);
    const drafts = db.list("drafts", (d) => d.guild === gid && d.guild === HOME_GUILD)
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    const building = db.list("requests", (r) => r.type === "draft" && r.guild === HOME_GUILD && ["sent", "queued", "working"].includes(r.status));
    return { ws, gid, guilds, guild, channels, cfg, autos, ob, scoring, allow, drafts, building };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);

  const { gid, channels } = derived;
  const shop = shops.find((s) => s.id === shopId) || null;
  const money = useMemo(() => moneyFormatter(shop?.region), [shop]);

  /* ---------- actions ---------- */
  const putDoc = useCallback(async (path, data) => {
    try {
      await db.set(path, data);
      return true;
    } catch (e) {
      toast(e?.code === "quota_exceeded" ? "Storage is full. Delete old drafts, then try again." : "Couldn’t save. Try again.");
      return false;
    }
  }, [toast]);

  const request = useCallback((type, payload) => ask(type, payload, gid), [gid]);

  const saveWs = useCallback((patch) => putDoc("workspace/main", { ...(db.get("workspace/main") || WS_DEFAULT), ...patch }), [putDoc]);

  const syncAllow = useCallback(async (autos, cfg) => {
    const ids = new Set();
    AUTOS.forEach((a) => {
      const s = autos[a.key];
      if (s.enabled && s.channel && s.channel !== "dm") ids.add(s.channel);
    });
    if (cfg.modChannel) ids.add(cfg.modChannel);
    const name = (id) => channels.find((c) => c.id === id)?.name || "";
    const list = [...ids].map((id) => ({ id, name: name(id) })).sort((a, b) => a.name.localeCompare(b.name));
    const prev = db.get("allowlist/" + gid);
    const same = prev && JSON.stringify((prev.channels || []).map((c) => c.id).sort()) === JSON.stringify(list.map((c) => c.id).sort());
    const doc = { guild: gid, channels: list, updatedAt: same ? prev.updatedAt : new Date().toISOString(), syncedAt: same ? prev.syncedAt || null : null };
    if (await putDoc("allowlist/" + gid, doc)) {
      if (!same) request("allowlist", {});
    }
  }, [channels, gid, putDoc, request]);

  const saveAutos = useCallback(async (autos, cfg = derived.cfg) => {
    const ok = await putDoc("automations/" + gid, { guild: gid, items: autos, updatedAt: new Date().toISOString() });
    if (ok) await syncAllow(autos, cfg);
    return ok;
  }, [derived.cfg, gid, putDoc, syncAllow]);

  const saveCfg = useCallback(async (cfg, { sync = true } = {}) => {
    const ok = await putDoc("config/" + gid, { guild: gid, ...cfg });
    if (ok && sync) await syncAllow(derived.autos, cfg);
    return ok;
  }, [derived.autos, gid, putDoc, syncAllow]);

  const saveScoring = useCallback((sc) => putDoc("scoring/" + gid, { guild: gid, ...sc }), [gid, putDoc]);
  const saveOb = useCallback((ob) => putDoc("onboarding/" + gid, { guild: gid, ...ob }), [gid, putDoc]);

  const setShop = useCallback((id) => {
    setShopId(id);
    try { localStorage.setItem("tvc.shop", id || ""); } catch { /* storage blocked */ }
  }, []);

  const setRange = useCallback((key, from, to) => {
    if (key === "c") setRangeState((r) => ({ key: "c", from: from || r.from, to: to || r.to }));
    else setRangeState(presetRange(key));
  }, []);

  const refresh = useCallback(() => {
    invalidateCruva();
    setRefreshKey((k) => k + 1);
  }, []);

  const resetDemo = useCallback(() => {
    db.reset();
    invalidateCruva();
    try { localStorage.removeItem("tvc.shop"); } catch { /* storage blocked */ }
    location.hash = "#welcome";
    setRefreshKey((k) => k + 1);
    toast("Demo data cleared. Start the setup guide again.");
  }, [toast]);

  const canPost = useCallback((id) => {
    const c = channels.find((x) => x.id === id);
    return !c || c.canPost !== false;
  }, [channels]);
  const chName = useCallback((id) => channels.find((x) => x.id === id)?.name || "", [channels]);

  const value = {
    booted, shops, shop, setShop, cruvaOk, bridgeOk: LIVE_LINK,
    range, setRange, refreshKey, refresh, money,
    ...derived, canPost, chName,
    toast, toastMsg, putDoc, request, saveWs, saveAutos, saveCfg, saveScoring, saveOb, resetDemo,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
