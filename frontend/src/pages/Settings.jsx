import { useEffect, useState } from "react";
import { useApp } from "../context/app.js";
import { api } from "../services/api.js";
import { auth } from "../services/auth.js";
import { AUTOS, TIMEZONES } from "../lib/constants.js";
import { CRMS, SLOTS, autoMatch, baseName, loadImage, readAvatar } from "../lib/setup.js";
import { ago, initials } from "../lib/format.js";
import { BotAvatar, ChanSelect, Dialog, Ico, PageHead, Sw } from "../components/ui.jsx";
import CommunityBuilder from "../components/CommunityBuilder.jsx";
import LogoCropper from "../components/LogoCropper.jsx";
const TABS = [["workspace", "Workspace", "home"], ["bot", "Bot & server", "server"], ["channels", "Channels", "hash"], ["crm", "CRM & data", "plug"], ["team", "Team", "users"], ["notifications", "Notifications", "bell"], ["billing", "Plan & billing", "card"]];
const PANELS = { workspace: Workspace, bot: Bot, channels: Channels, crm: Crm, team: Team, notifications: Notifications, billing: Billing };

export default function Settings() {
  const { view, setView } = useApp();
  const tabs = TABS;
  const t = PANELS[view.set] ? view.set : "workspace";
  const Panel = PANELS[t];
  return (
    <>
      <PageHead title="Settings" desc="Your workspace, bot, channels, data and team." />
      <div className="set">
        <nav className="setnav" aria-label="Settings sections">
          {tabs.map(([k, l, i]) => <button key={k} type="button" className={t === k ? "on" : ""} onClick={() => setView({ set: k })}><Ico name={i} />{l}</button>)}
        </nav>
        <div className="setbody"><Panel /></div>
      </div>
    </>
  );
}

function Workspace() {
  const { user, ws, cfg, saveCfg, saveWs, resetWorkspace, toast, isAdmin } = useApp();
  const [name, setName] = useState(user.name);
  const [brand, setBrand] = useState(user.brand);
  const [zone, setZone] = useState(cfg.timezone);
  const [week, setWeek] = useState(cfg.weekStart);
  const [confirm, setConfirm] = useState(false);
  // The company logo waits here until Save: undefined = unchanged, null = removed, { logo, w, h } = new or re-cropped.
  const [logoDraft, setLogoDraft] = useState(undefined);
  const [cropImg, setCropImg] = useState(null);
  const [colors, setColors] = useState(null);
  const [saving, setSaving] = useState(false);
  const owner = user.role === "Owner";
  const logo = (logoDraft === undefined ? ws.brand?.logo : logoDraft?.logo) || "";
  const logoChanged = logoDraft !== undefined;

  // Card colors for the logo on screen: read straight from an unsaved logo, or the saved theme.
  useEffect(() => {
    let live = true;
    const ask = logoDraft?.logo ? api("POST", "/brand/preview", { logo: logoDraft.logo }) : logoDraft === null ? Promise.resolve({ source: "no_logo" }) : api("GET", "/brand");
    ask.then((r) => live && setColors(r)).catch(() => live && setColors(null));
    return () => { live = false; };
  }, [logoDraft, ws.brand?.logo]);

  const pick = async (file) => {
    try {
      setCropImg(await loadImage(file));
    } catch (e) {
      toast(e.message);
    }
  };
  const recrop = async () => {
    try {
      setCropImg(await loadImage(logo));
    } catch (e) {
      toast(e.message);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      try {
        await auth.update({ name, brand });
      } catch (e) {
        return toast(e.message);
      }
      if (isAdmin && (zone !== cfg.timezone || week !== cfg.weekStart) && !(await saveCfg({ ...cfg, timezone: zone, weekStart: week }, { sync: false }))) return;
      if (isAdmin && logoChanged) {
        if (!(await saveWs({ brand: logoDraft }))) return;
        setLogoDraft(undefined);
        return toast(logoDraft ? "Saved. New cards use your logo and its colors." : "Saved. Cards are back to the default colors.");
      }
      toast("Saved");
    } finally {
      setSaving(false);
    }
  };

  const c = colors?.detected || colors?.default || { primary: "#0A9444", secondary: "#D3263A" };
  const second = c.secondary || c.primary;
  const note = !logo ? "No logo yet, so cards use the default colors."
    : colors?.source === "logo" ? "Cards take these colors from your logo automatically."
    : colors?.source === "no_colors" ? "No clear colors in this logo, so cards use the default colors. A logo with stronger colors works best."
    : "";

  return (
    <>
      <section className="card2">
        <div className="h"><h3>Workspace</h3></div>
        <div className="frow">
          <label className="field">Brand name<input className="input" value={brand} disabled={!owner} onChange={(e) => setBrand(e.target.value)} /></label>
          <label className="field">Your name<input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        </div>

        <div className="logo-field">
          <span>Company logo</span>
          <div className="logo-up">
            <div className={"logo-tile" + (logo ? " has" : "")}>{logo ? <img src={logo} alt="Company logo" /> : <Ico name="upload" />}</div>
            <div className="btns">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <label className={"btn sm" + (isAdmin ? "" : " disabled")} htmlFor="logo-file"><Ico name="upload" />{logo ? "Change logo" : "Upload logo"}</label>
                {logo && <button className="btn sm" type="button" disabled={!isAdmin} onClick={recrop}><Ico name="edit" />Crop</button>}
                {logo && <button className="btn sm ghost" type="button" disabled={!isAdmin} onClick={() => setLogoDraft(null)}>Remove</button>}
                {logoChanged && <button className="btn sm ghost" type="button" onClick={() => setLogoDraft(undefined)}>Undo</button>}
              </div>
              <small>Shown on the winning angle, creator win and leaderboard images, which take their colors from it. Separate from the bot’s picture. PNG with a transparent background works best; you can crop it after picking.</small>
            </div>
            <input type="file" id="logo-file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden disabled={!isAdmin} onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) pick(f); }} />
          </div>
          <div className="logo-colors" aria-label="Card colors from your logo">
            <span className="lc-sw"><i style={{ background: c.primary }} />Main {c.primary}</span>
            <span className="lc-sw"><i style={{ background: second }} />Second {second}</span>
            <span className="bar" aria-hidden="true"><span style={{ background: c.primary }} /><span style={{ background: "#fff" }} /><span style={{ background: second }} /></span>
            {note && <small className="muted" style={{ flexBasis: "100%", fontSize: "var(--text-micro)" }}>{note}</small>}
          </div>
        </div>

        <div className="frow">
          <label className="field">Time zone<select className="input" value={zone} disabled={!isAdmin} onChange={(e) => setZone(e.target.value)}>{TIMEZONES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><small>Automations run at their set time in this zone.</small></label>
          <label className="field">Week starts on<select className="input" value={week} disabled={!isAdmin} onChange={(e) => setWeek(e.target.value)}><option>Sunday</option><option>Monday</option></select></label>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn primary" type="button" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save changes"}</button>
          {logoChanged && <span className="unsaved">{logoDraft ? "New logo not saved yet" : "Logo removal not saved yet"}</span>}
        </div>
      </section>
      {isAdmin && (
        <section className="card2">
          <div className="h"><h3>Danger zone</h3><p>Deletes this workspace’s settings, automations, drafts, DMs and analytics, and starts setup again. Nothing is removed from Discord, and your account stays.</p></div>
          <div><button className="btn" type="button" style={{ color: "var(--color-danger)" }} onClick={() => setConfirm(true)}>Delete workspace</button></div>
        </section>
      )}
      {cropImg && <LogoCropper img={cropImg} onClose={() => setCropImg(null)} onDone={(l) => { setLogoDraft(l); setCropImg(null); }} />}
      {confirm && (
        <Dialog title="Delete this workspace?" onClose={() => setConfirm(false)} actions={<><button className="btn" type="button" onClick={() => setConfirm(false)}>Keep it</button><button className="btn primary" type="button" onClick={() => { setConfirm(false); resetWorkspace(); }}>Delete workspace</button></>}>
          <p className="muted" style={{ fontSize: "var(--text-small)" }}>Everything saved for this workspace is deleted and can’t be brought back. Channels and messages in Discord stay as they are.</p>
        </Dialog>
      )}
    </>
  );
}

function Bot() {
  const { ws, guild, cfg, autos, botName, botAvatar, channels, members, conn, discordInfo, saveWs, saveCfg, saveAutos, requestWait, checkDiscord, toast, user, isAdmin } = useApp();
  const [name, setName] = useState(botName);
  const [busy, setBusy] = useState("");
  const [building, setBuilding] = useState(false);

  const apply = async (patch) => {
    const bot = { name, avatar: botAvatar, ...patch };
    setBusy("save");
    const ok = (await saveWs({ bot })) && (await saveCfg({ ...cfg, botName: bot.name.trim() || botName }, { sync: false }));
    const r = ok && (await requestWait("profile", { name: bot.name.trim() || botName, avatar: bot.avatar }));
    setBusy("");
    if (!r) return;
    toast(!r.ok ? r.error : r.result.warning || `Saved. The bot’s nickname is updated in ${guild.guildName}.`);
  };
  const sync = async () => {
    setBusy("sync");
    const [r] = await Promise.all([requestWait("sync", {}), checkDiscord()]);
    setBusy("");
    toast(r.ok ? `Synced ${channels.length} channels from ${guild?.guildName || "Discord"}` : r.error);
  };
  const onCreate = async (todo) => {
    const r = await requestWait("create_channels", { channels: todo });
    setBuilding(false);
    if (!r.ok) return toast(r.error);
    await saveWs({ newChannels: [...(ws.newChannels || []), ...r.result.created] });
    // Point automations that have no channel yet at the channel the template made for them (any name, AI layouts included).
    // Channels someone already picked are left alone.
    const all = r.result.guild?.channels || [];
    const made = (key) => { const want = todo.find((x) => x.auto === key); return want ? all.find((c) => baseName(c.name) === baseName(want.name))?.id : null; };
    const nextAutos = { ...autos };
    let wired = 0;
    for (const a of AUTOS) {
      const id = !autos[a.key]?.channel && made(a.key);
      if (id) { nextAutos[a.key] = { ...autos[a.key], channel: id }; wired++; }
    }
    const modId = !cfg.modChannel && made("mod");
    const nextCfg = modId ? { ...cfg, modChannel: modId } : cfg;
    if (modId) wired++;
    if (wired && (!modId || (await saveCfg(nextCfg, { sync: false })))) await saveAutos(nextAutos, nextCfg);
    const n = r.result.created.length;
    toast(!n ? "Those channels already exist. Nothing was created."
      : `${n} channels created in ${guild.guildName}.${wired ? ` ${wired} automation${wired === 1 ? " now posts" : "s now post"} in ${wired === 1 ? "its" : "their"} new channel.` : " Point automations at them in Channels."}`);
  };
  const g = conn.gateway;
  const checks = [
    [discordInfo.configured, "Bot token", discordInfo.configured ? discordInfo.bot?.name : discordInfo.error || "Add DISCORD_BOT_TOKEN to backend/.env"],
    [g.connected, "Listening to Discord live", g.connected ? "Joins, DMs, messages and reactions arrive as they happen" : g.error || "Not connected. Restart the backend if this stays."],
    [g.members, "Server Members Intent", g.members ? "The bot sees who joins, so it can welcome them" : "Off. Turn it on in the Developer Portal → Bot, then restart the backend."],
    [g.content, "Message Content Intent", g.content ? "The chat manager can read messages" : "Off. Only needed for the general chat manager to read messages that don’t @mention it."],
    [guild?.canManageChannels, "Manage channels", guild?.canManageChannels ? "The community builder can create channels" : "The bot’s role can’t create channels in this server"],
    [conn.ai, "AI key for the chat manager", conn.ai ? "Connected" : "Optional. Add ANTHROPIC_API_KEY to backend/.env to switch on chat replies."],
  ];
  return (
    <>
      <section className="card2">
        <div className="h"><h3>Bot identity</h3><p>What creators see on every post.</p></div>
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <div className="bav" style={{ width: 64, height: 64, fontSize: 24 }}><BotAvatar /></div>
          <label className={"btn sm" + (isAdmin ? "" : " disabled")} htmlFor="st-file"><Ico name="upload" />{botAvatar ? "Change picture" : "Upload picture"}</label>
          <input type="file" id="st-file" accept="image/*" hidden disabled={!isAdmin} onChange={async (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) apply({ avatar: await readAvatar(f) }); }} />
          {botAvatar && <button className="btn sm ghost" type="button" disabled={!isAdmin} onClick={() => apply({ avatar: "" })}>Remove</button>}
        </div>
        <label className="field">Bot name<input className="input" value={name} maxLength={32} disabled={!isAdmin} onChange={(e) => setName(e.target.value)} /><small>Set as the bot’s nickname in your server. Discord only lets some bots have a per-server picture; if yours can’t, the picture shows here and in previews only.</small></label>
        <div><button className="btn primary" type="button" disabled={!isAdmin || !!busy} onClick={() => apply({})}>{busy === "save" ? "Saving…" : "Save"}</button></div>
      </section>
      <section className="card2">
        <div className="h"><h3>Discord server</h3><div className="r"><button className="btn sm" type="button" disabled={!isAdmin || !!busy} onClick={sync}><Ico name="redo" />{busy === "sync" ? "Refreshing…" : "Refresh"}</button></div></div>
        <div className="dl">
          <div><span className="k">Server</span><span className="v">{guild?.guildName || "None"}</span>{guild && <span className="pill good">Connected</span>}</div>
          <div><span className="k">Channels</span><span className="v">{channels.length} text channels, {channels.filter((c) => c.canPost !== false).length} the bot can post in</span><span /></div>
          <div><span className="k">Members</span><span className="v">{members?.allowed === false ? "Can’t be listed (Server Members Intent is off)" : `${(members?.list || []).filter((m) => !m.bot && !m.left).length} people`}</span><span /></div>
          <div><span className="k">Last synced</span><span className="v">{ago(guild?.syncedAt)}</span><span /></div>
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {checks.map(([ok, label, detail]) => (
            <div key={label} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: "var(--text-small)" }}>
              <span className={"pill " + (ok ? "good" : "line")} style={{ flex: "none" }}>{ok ? <Ico name="check" /> : <Ico name="x" />}{ok ? "On" : "Off"}</span>
              <div><b style={{ color: "var(--color-heading)", fontWeight: 500 }}>{label}</b><div className="muted" style={{ fontSize: "var(--text-micro)" }}>{detail}</div></div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {discordInfo.inviteUrl && <a className="btn" href={discordInfo.inviteUrl} target="_blank" rel="noopener noreferrer"><Ico name="external" />Re-invite or update permissions</a>}
          <a className="btn" href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer"><Ico name="external" />Developer Portal</a>
          {guild && <button className="btn" type="button" disabled={!isAdmin} onClick={() => setBuilding(true)}><Ico name="blocks" />Open AI Community Builder</button>}
        </div>
      </section>
      {building && <div className="site"><CommunityBuilder guild={guild} brand={user.brand} onCreate={onCreate} onClose={() => setBuilding(false)} /></div>}
    </>
  );
}

function Channels() {
  const { ws, guild, channels, autos, cfg, saveWs, saveCfg, saveAutos, toast, isAdmin } = useApp();
  const current = (k) => (k === "mod" ? cfg.modChannel : autos[k]?.channel) || "";
  const setSlot = async (key, id) => {
    let ok;
    if (key === "mod") ok = await saveCfg({ ...cfg, modChannel: id });
    else ok = await saveAutos({ ...autos, [key]: { ...autos[key], channel: id, enabled: id ? autos[key].enabled : key === "onboarding" ? autos[key].enabled : false } });
    if (ok) { saveWs({ map: { ...(ws.map || {}), [key]: id } }); toast("Saved"); }
  };
  const rematch = async () => {
    const map = autoMatch(channels, {}, true);
    const next = {};
    AUTOS.forEach((a) => (next[a.key] = { ...autos[a.key], channel: map[a.key] || autos[a.key].channel }));
    const nextCfg = { ...cfg, modChannel: map.mod || cfg.modChannel };
    if ((await saveCfg(nextCfg, { sync: false })) && (await saveAutos(next, nextCfg))) toast("Channels matched by name");
  };
  const fresh = new Set((ws.newChannels || []).map(baseName));
  return (
    <>
      <section className="card2">
        <div className="h"><h3>Channels per automation</h3><div className="r"><button className="btn sm ghost" type="button" disabled={!isAdmin} onClick={rematch}><Ico name="redo" />Auto-match</button></div><p>Where each automation posts in {guild?.guildName || "your server"}.</p></div>
        <div className="maptable" style={{ margin: 0 }}>
          {SLOTS.filter((s) => s.key !== "onboarding").map((s) => (
            <div key={s.key} className="maprow">
              <div style={{ minWidth: 0 }}><b>{s.name}{s.req && <> <span className="pill rose">Required</span></>}</b><span>{s.what}</span></div>
              <ChanSelect value={current(s.key)} disabled={!isAdmin} onChange={(id) => setSlot(s.key, id)} none={s.req ? "Choose a channel…" : "No channel"} />
            </div>
          ))}
        </div>
      </section>
      <section className="card2">
        <div className="h"><h3>All channels</h3><p>{channels.length} text channels the bot can see.</p></div>
        <div className="tblwrap"><table className="tbl" style={{ minWidth: 520 }}>
          <thead><tr><th>Channel</th><th>Category</th><th>Used by</th></tr></thead>
          <tbody>{channels.map((c) => {
            const by = SLOTS.filter((s) => current(s.key) === c.id).map((s) => s.name);
            return (
              <tr key={c.id} style={{ cursor: "default" }}>
                <td><b style={{ color: "var(--color-heading)", fontWeight: 500 }}>#{c.name}</b>{fresh.has(baseName(c.name)) && <> <span className="pill">Created by Kreo</span></>}{c.canPost === false && <> <span className="pill rose">Bot can’t post</span></>}</td>
                <td className="muted">{c.category || "No category"}</td>
                <td>{by.length ? by.map((x) => <span key={x} className="pill line" style={{ marginRight: 4 }}>{x}</span>) : <span className="muted">—</span>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </section>
    </>
  );
}

function Crm() {
  const { ws, crmName, crmLive, crmConn, connectCrm, disconnectCrm, shops, shop, setShop, saveWs, cfg, saveCfg, refresh, toast, isAdmin } = useApp();
  const pref = (k, v) => saveCfg({ ...cfg, [k]: v }, { sync: false }).then((ok) => ok && toast("Saved"));
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmOff, setConfirmOff] = useState(false);
  const own = !!crmConn?.readable;
  const unreadable = crmConn && !crmConn.readable;
  const showForm = isAdmin && (editing || (!crmLive && !crmConn) || unreadable);

  const connect = async () => {
    if (!key.trim()) return setError("Paste your Cruva API key first.");
    setBusy(true);
    setError("");
    try {
      const r = await connectCrm("cruva", key.trim());
      const list = r.shops || [];
      const shopId = list.some((x) => x.id === ws.shopId) ? ws.shopId : list[0]?.id || "";
      await saveWs({ crm: { id: "cruva", ok: true }, shopId });
      setKey("");
      setEditing(false);
      toast(`Cruva connected: ${list.length} shop${list.length === 1 ? "" : "s"} found`);
    } catch (e) {
      setError(e.message || "Couldn’t connect. Try again.");
    }
    setBusy(false);
  };
  const disconnect = async () => {
    setBusy(true);
    try {
      await disconnectCrm();
      setConfirmOff(false);
      toast("Cruva disconnected. The key was deleted.");
    } catch (e) {
      toast(e.message);
    }
    setBusy(false);
  };

  return (
    <>
      <section className="card2">
        <div className="h"><h3>Connected CRM</h3></div>
        {unreadable ? <div className="hint warn"><Ico name="plug" /><div>The saved Cruva key can’t be read on the server any more (its encryption secret changed). Paste the key again to reconnect.</div></div>
          : crmLive ? <div className="hint"><Ico name="check" /><div>Live: sales numbers, videos, products and creator contact details come straight from your {crmName} account, refreshed every few minutes.</div></div>
          : <div className="hint warn"><Ico name="plug" /><div>No live CRM connection yet. Sales numbers, videos, products and creator contact details are <b>sample data</b>. Connect your Cruva API key below to switch this workspace to your real data. Everything from Discord (members, activity, DMs, posts) is already real.</div></div>}
        <div className="dl">
          <div><span className="k">Provider</span><span className="v">{crmName}</span><span className={crmLive ? "pill good" : "pill line"}>{crmLive ? "Live" : "Sample data"}</span></div>
          {own && <div><span className="k">API key</span><span className="v mono">••••{crmConn.last4}</span><span className="muted" style={{ fontSize: "var(--text-micro)" }}>Connected {ago(crmConn.connectedAt)}</span></div>}
          {crmLive && !crmConn && <div><span className="k">API key</span><span className="v">The server’s own Cruva connection</span><span /></div>}
          <div><span className="k">Shop</span><span className="v">{shops.length > 1 ? <select className="input" style={{ height: 34 }} value={shop?.id || ""} disabled={!isAdmin} onChange={(e) => setShop(e.target.value)}>{shops.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.region.toUpperCase()}</option>)}</select> : shop?.name || "—"}</span><span /></div>
          <div><span className="k">Access</span><span className="v">Read-only</span><button className="btn sm ghost" type="button" onClick={() => { refresh(); toast("Reloaded CRM data"); }}>Reload</button></div>
        </div>
        {showForm && (
          <div style={{ display: "grid", gap: 8 }}>
            <label className="field" htmlFor="set-crm-key">{own || crmLive ? "New Cruva API key" : "Cruva API key"}<small>{CRMS.find((x) => x.id === "cruva").how} It’s checked with Cruva, stored encrypted, and never shown again.</small></label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input className="input" id="set-crm-key" type="password" autoComplete="off" spellCheck={false} style={{ flex: "1 1 240px" }} value={key} disabled={busy}
                placeholder="cruva_live_••••••••••••••••" aria-invalid={error ? "true" : undefined}
                onChange={(e) => { setKey(e.target.value); setError(""); }} onKeyDown={(e) => { if (e.key === "Enter") connect(); }} />
              <button className="btn primary" type="button" disabled={busy} onClick={connect}><Ico name="plug" />{busy ? "Checking…" : own ? "Replace key" : "Connect"}</button>
              {editing && <button className="btn ghost" type="button" disabled={busy} onClick={() => { setEditing(false); setKey(""); setError(""); }}>Cancel</button>}
            </div>
            {error && <p className="err" role="alert">{error}</p>}
          </div>
        )}
        {isAdmin && !showForm && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn sm" type="button" onClick={() => setEditing(true)}><Ico name="plug" />{own ? "Replace key" : "Use my own Cruva key"}</button>
            {own && <button className="btn sm ghost" type="button" onClick={() => setConfirmOff(true)}>Disconnect</button>}
          </div>
        )}
        <div className="sec-t" style={{ margin: 0 }}>Other sources</div>
        <div className="crms" style={{ margin: 0 }}>{CRMS.filter((c) => c.id !== "cruva").map((x) => <div key={x.id} className="crm" style={{ cursor: "default" }}><span className="mk">{x.mono}</span><b>{x.name}</b><span>{x.reads}. Coming soon.</span></div>)}</div>
      </section>
      {confirmOff && (
        <Dialog title="Disconnect Cruva?" onClose={() => setConfirmOff(false)} actions={<>
          <button className="btn ghost" type="button" onClick={() => setConfirmOff(false)}>Cancel</button>
          <button className="btn primary" type="button" disabled={busy} onClick={disconnect}>Disconnect</button>
        </>}>
          <p className="muted">The saved key is deleted from Kreo. Analytics, the leaderboard, creator wins and winning angles go back to sample data until you connect a key again. Nothing changes in Cruva.</p>
        </Dialog>
      )}
      <section className="card2">
        <div className="h"><h3>Contact details</h3><p>How Kreo fills in creator contact info.</p></div>
        <div className="trow"><div><b>Find phone numbers in DMs</b><span>Any number a creator shares with the bot is saved to their profile, marked “From DM”</span></div><Sw checked={cfg.waDetect !== false} disabled={!isAdmin} label="Find phone numbers" onChange={(v) => pref("waDetect", v)} /></div>
        <div className="trow"><div><b>Link Discord members to {crmName} creators</b><span>Always on: matched by the TikTok handle they give in onboarding</span></div><span className="pill good">On</span></div>
      </section>
    </>
  );
}

function Team() {
  const { cfg, chName, toast, isAdmin } = useApp();
  const [team, setTeam] = useState(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("Moderator");
  const call = async (method, path, body) => {
    try {
      setTeam(await api(method, path, body));
      return true;
    } catch (e) {
      toast(e.message);
      return false;
    }
  };
  useEffect(() => { api("GET", "/team").then(setTeam, () => setTeam({ members: [], invites: [] })); }, []);
  const invite = async (e) => {
    e.preventDefault();
    if (await call("POST", "/team", { email, role })) { toast(`${email} can now sign up and join this workspace`); setEmail(""); }
  };
  const path = (em) => "/team/" + encodeURIComponent(em);
  const RoleSelect = ({ value, em, disabled }) => (
    <select className="input" style={{ width: 150, height: 36 }} value={value} disabled={disabled || !isAdmin} aria-label="Role" onChange={(e) => call("PUT", path(em), { role: e.target.value })}>
      {value === "Owner" && <option>Owner</option>}<option>Admin</option><option>Moderator</option><option>Viewer</option>
    </select>
  );
  return (
    <section className="card2">
      <div className="h"><h3>Team</h3><p>People who can approve drafts and change settings.</p></div>
      {(team?.members || []).map((m) => (
        <div key={m.email} className="trow">
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}><span className="cav">{initials(m.name)}</span><div><b>{m.name}</b><span>{m.email}</span></div></div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}><RoleSelect value={m.role} em={m.email} disabled={m.role === "Owner"} />{m.role !== "Owner" && isAdmin && <button className="btn sm ghost" type="button" onClick={() => call("DELETE", path(m.email))}>Remove</button>}</div>
        </div>
      ))}
      {(team?.invites || []).map((m) => (
        <div key={m.email} className="trow">
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}><span className="cav">{initials(m.email)}</span><div><b>{m.email}</b><span>Invited · hasn’t signed up yet</span></div></div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}><RoleSelect value={m.role} em={m.email} />{isAdmin && <button className="btn sm ghost" type="button" onClick={() => call("DELETE", path(m.email))}>Cancel</button>}</div>
        </div>
      ))}
      {isAdmin && (
        <form onSubmit={invite} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input className="input" style={{ flex: "1 1 220px" }} type="email" required placeholder="teammate@brand.com" aria-label="Email to invite" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select className="input" style={{ width: 150 }} value={role} aria-label="Role" onChange={(e) => setRole(e.target.value)}><option>Admin</option><option>Moderator</option><option>Viewer</option></select>
          <button className="btn primary" type="submit"><Ico name="plus" />Invite</button>
        </form>
      )}
      <p className="muted" style={{ fontSize: "var(--text-micro)" }}>No email is sent: ask your teammate to sign up at this site with the invited address and they join this workspace. Admins can change everything. Moderators can approve drafts and reply to DMs here{cfg.modChannel ? ` and in #${chName(cfg.modChannel)}` : ""}. Viewers can only look.</p>
    </section>
  );
}

function Notifications() {
  const { cfg, saveCfg, chName, toast, isAdmin } = useApp();
  const mod = cfg.modChannel ? "#" + chName(cfg.modChannel) : "your approvals channel";
  const rows = [["notifyDraft", "New drafts to approve", "Posts each new draft there, where a moderator can react ✅ or ❌"], ["notifyDm", "DMs that need a reply", "When a creator asks the bot something after onboarding"], ["digest", "Weekly summary", "Mondays at 9:00 AM: last week’s numbers"]];
  return (
    <section className="card2">
      <div className="h"><h3>Notifications</h3><p>What Kreo posts in {mod} for your team. Email notifications aren’t available yet.</p></div>
      {rows.map(([k, l, d]) => (
        <div key={k} className="trow"><div><b>{l}</b><span>{d}</span></div><Sw checked={k === "digest" ? !!cfg[k] : cfg[k] !== false} disabled={!isAdmin} label={l} onChange={(v) => saveCfg({ ...cfg, [k]: v }, { sync: false }).then((ok) => ok && toast("Saved"))} /></div>
      ))}
    </section>
  );
}

function Billing() {
  const plans = [["Starter", 99, ["1 Discord server", "4 built-in automations", "Approvals in Discord + Kreo"]], ["Growth", 249, ["Everything in Starter", "All 6 automations + custom", "DM inbox and WhatsApp capture"], true], ["Agency", 599, ["Up to 10 brands", "Custom bots per brand", "Priority support"]]];
  return (
    <section className="card2">
      <div className="h"><h3>Plan</h3><p>Billing isn’t connected yet: nothing is charged, every feature is available, and the trial counter doesn’t lock anything.</p></div>
      <div className="plans">
        {plans.map(([n, p, f, on]) => (
          <div key={n} className={"plan" + (on ? " on" : "")}><b>{n}</b><div className="price">${p}<small> /month</small></div><ul>{f.map((x) => <li key={x}>{x}</li>)}</ul><button className={"btn sm" + (on ? " primary" : "")} type="button" disabled>{on ? "Current trial" : "Not available yet"}</button></div>
        ))}
      </div>
      <p className="muted" style={{ fontSize: "var(--text-micro)" }}>Placeholder prices. Checkout needs a payment provider, which hasn’t been set up.</p>
    </section>
  );
}
