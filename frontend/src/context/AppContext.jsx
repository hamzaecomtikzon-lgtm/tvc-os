import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db, useDb } from "../services/db.js";
import { cruva, invalidateCruva } from "../services/cruva.js";
import { ask, askWait } from "../services/bridge.js";
import { api } from "../services/api.js";
import { useAuth } from "../services/auth.js";
import { AppCtx } from "./app.js";
import { AUTOS, DEFAULT_BOT, defaultAutos, defaultOb, defaultPrefs, defaultScoring, guessChannel, mergeAutos } from "../lib/constants.js";
import { moneyFormatter, presetRange } from "../lib/format.js";

const EMPTY = [];
const WS_DEFAULT = { guildId: "", shopId: "", done: false };

export function AppProvider({ children }) {
  const v = useDb();
  const user = useAuth();
  const [booted, setBooted] = useState(false);
  const [shops, setShops] = useState(EMPTY);
  const [serverOk, setServerOk] = useState(true);
  // What the server is connected to: { discord: { configured, bot, inviteUrl, error }, gateway: { connected, members, content }, ai }
  const [conn, setConn] = useState({ discord: { configured: null }, gateway: {}, ai: false });
  const [range, setRange] = useState(() => presetRange("7"));
  const [refreshKey, setRefreshKey] = useState(0);
  const [toastMsg, setToastMsg] = useState("");
  // Where each page's tabs are, so links can open a page on the right one: { an, ct, ob, set, dm, q, ap }
  const [view, setViewState] = useState({});
  const [creator, setCreator] = useState(null); // the creator shown in the side drawer
  const toastTimer = useRef(0);

  const toast = useCallback((t) => {
    setToastMsg(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), 3400);
  }, []);
  const setView = useCallback((patch) => setViewState((s) => ({ ...s, ...patch })), []);
  /** Go to a page, optionally on a given tab: go("workspace", { set: "billing" }). */
  const go = useCallback((page, patch) => {
    if (patch) setViewState((s) => ({ ...s, ...patch }));
    setCreator(null);
    location.hash = "#" + page;
  }, []);

  /** Ask the server what it's connected to. Returns the Discord part. */
  const checkDiscord = useCallback(async () => {
    try {
      const c = await api("GET", "/config");
      setConn(c);
      return c.discord;
    } catch (e) {
      const discord = { configured: false, error: e.message };
      setConn((c) => ({ ...c, discord }));
      return discord;
    }
  }, []);

  /* ---------- boot: the account's documents, the bot, and brands from the CRM ---------- */
  useEffect(() => {
    let live = true;
    (async () => {
      checkDiscord();
      try {
        await db.ready();
      } catch {
        if (live) setServerOk(false);
      }
      try {
        const list = await cruva.listShops();
        if (live) setShops(list);
      } catch { /* pages that need the CRM say so themselves */ }
      if (live) setBooted(true);
    })();
    return () => { live = false; };
  }, [checkDiscord]);

  /* ---------- workspace state derived from the store ---------- */
  const derived = useMemo(() => {
    const ws = db.get("workspace/main") || WS_DEFAULT;
    const gid = ws.guildId;
    const guilds = db.list("discord").sort((a, b) => a.guildName.localeCompare(b.guildName));
    const guild = guilds.find((g) => g.guildId === gid) || null;
    const channels = guild?.channels || EMPTY;
    const base = { ws, gid, guilds, guild, channels, drafts: EMPTY, building: EMPTY, dms: EMPTY, customs: EMPTY, members: null, allow: null };
    if (!gid) {
      return { ...base, cfg: { botName: DEFAULT_BOT, modChannel: "", ...defaultPrefs() }, autos: defaultAutos(channels), ob: defaultOb(), scoring: defaultScoring() };
    }
    const cfg = {
      botName: guild?.botName || DEFAULT_BOT, modChannel: guessChannel(channels, ["moderator-only", "moderator"]),
      ...defaultPrefs(), ...(db.get("config/" + gid) || {}),
    };
    const autosDoc = db.get("automations/" + gid);
    return {
      ...base, cfg,
      autos: autosDoc?.items ? mergeAutos(defaultAutos(channels), autosDoc.items) : defaultAutos(channels),
      ob: { ...defaultOb(), ...(db.get("onboarding/" + gid) || {}) },
      scoring: { ...defaultScoring(), ...(db.get("scoring/" + gid) || {}) },
      allow: db.get("allowlist/" + gid),
      drafts: db.list("drafts", (d) => d.guild === gid && !d.test && d.status !== "replaced").sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")),
      building: db.list("requests", (r) => r.type === "draft" && r.guild === gid && r.status === "working"),
      dms: db.list("dms", (d) => d.guild === gid).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")),
      customs: db.list("custom", (c) => c.guild === gid).sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || "")),
      members: db.get("members/" + gid),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);

  const { gid, channels, ws } = derived;
  const shop = shops.find((s) => s.id === ws.shopId) || shops[0] || null;
  const money = useMemo(() => moneyFormatter(shop?.region), [shop]);
  const canEdit = user?.role !== "Viewer";
  const isAdmin = user?.role === "Owner" || user?.role === "Admin";

  /* ---------- actions ---------- */
  const putDoc = useCallback(async (path, data) => {
    try {
      await db.set(path, data);
      return true;
    } catch (e) {
      toast(e?.code === "offline" ? "Couldn’t save: the server isn’t answering. Try again in a moment." : "Couldn’t save. " + (e?.message || "Try again."));
      db.open(""); // drop the unsaved copy and read what the server has
      db.open(user?.workspace);
      return false;
    }
  }, [toast, user]);

  const request = ask;
  const requestWait = askWait;

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
    if (same) return;
    if (await putDoc("allowlist/" + gid, { guild: gid, channels: list, updatedAt: new Date().toISOString(), syncedAt: null })) request("allowlist", {});
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
  const saveCustom = useCallback((id, c) => putDoc("custom/" + id, { guild: gid, ...c }), [gid, putDoc]);
  const setShop = useCallback((id) => saveWs({ shopId: id }), [saveWs]);

  const refresh = useCallback(() => {
    invalidateCruva();
    setRefreshKey((k) => k + 1);
  }, []);

  /** Delete the workspace's saved data and start setup again. Nothing is removed from Discord. */
  const resetWorkspace = useCallback(async () => {
    try {
      await db.reset();
    } catch (e) {
      return toast("Couldn’t delete the workspace. " + (e?.message || ""));
    }
    invalidateCruva();
    location.hash = "#dashboard";
    setRefreshKey((k) => k + 1);
    toast("Workspace deleted. Set it up again.");
  }, [toast]);

  const canPost = useCallback((id) => {
    const c = channels.find((x) => x.id === id);
    return !c || c.canPost !== false;
  }, [channels]);
  const chName = useCallback((id) => (id === "dm" ? "Direct message" : channels.find((x) => x.id === id)?.name || ""), [channels]);

  const value = {
    v, user, canEdit, isAdmin, booted, shops, shop, setShop, serverOk,
    conn, discordInfo: conn.discord, checkDiscord,
    range, setRange, refreshKey, refresh, money,
    ...derived, canPost, chName,
    botName: derived.cfg.botName || DEFAULT_BOT, botAvatar: ws.bot?.avatar || "",
    crmName: { cruva: "Cruva", euka: "Euka", reacher: "Reacher" }[ws.crm?.id] || "your CRM",
    view, setView, go, creator, openCreator: setCreator,
    toast, toastMsg, putDoc, request, requestWait, saveWs, saveAutos, saveCfg, saveScoring, saveOb, saveCustom, resetWorkspace,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
