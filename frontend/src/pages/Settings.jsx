import { useEffect, useState } from "react";
import { useApp } from "../context/app.js";
import { api } from "../services/api.js";
import { auth } from "../services/auth.js";
import { AUTOS, TIMEZONES } from "../lib/constants.js";
import { CRMS, SLOTS, autoMatch, baseName, readAvatar } from "../lib/setup.js";
import { ago, initials } from "../lib/format.js";
import { BotAvatar, ChanSelect, Dialog, Ico, PageHead, Sw } from "../components/ui.jsx";
import CommunityBuilder from "../components/CommunityBuilder.jsx";

const TABS = [["workspace", "Workspace", "home"], ["bot", "Bot & server", "server"], ["channels", "Channels", "hash"], ["crm", "CRM & data", "plug"], ["team", "Team", "users"], ["notifications", "Notifications", "bell"], ["billing", "Plan & billing", "card"]];
const PANELS = { workspace: Workspace, bot: Bot, channels: Channels, crm: Crm, team: Team, notifications: Notifications, billing: Billing };

export default function Settings() {
  const { view, setView } = useApp();
  const t = PANELS[view.set] ? view.set : "workspace";
  const Panel = PANELS[t];
  return (
    <>
      <PageHead title="Settings" desc="Your workspace, bot, channels, data and team." />
      <div className="set">
        <nav className="setnav" aria-label="Settings sections">
          {TABS.map(([k, l, i]) => <button key={k} type="button" className={t === k ? "on" : ""} onClick={() => setView({ set: k })}><Ico name={i} />{l}</button>)}
        </nav>
        <div className="setbody"><Panel /></div>
      </div>
    </>
  );
}

function Workspace() {
  const { user, cfg, saveCfg, resetWorkspace, toast, isAdmin } = useApp();
  const [name, setName] = useState(user.name);
  const [brand, setBrand] = useState(user.brand);
  const [zone, setZone] = useState(cfg.timezone);
  const [week, setWeek] = useState(cfg.weekStart);
  const [confirm, setConfirm] = useState(false);
  const owner = user.role === "Owner";
  const save = async () => {
    try {
      await auth.update({ name, brand });
    } catch (e) {
      return toast(e.message);
    }
    if (isAdmin && (zone !== cfg.timezone || week !== cfg.weekStart) && !(await saveCfg({ ...cfg, timezone: zone, weekStart: week }, { sync: false }))) return;
    toast("Saved");
  };
  return (
    <>
      <section className="card2">
        <div className="h"><h3>Workspace</h3></div>
        <div className="frow">
          <label className="field">Brand name<input className="input" value={brand} disabled={!owner} onChange={(e) => setBrand(e.target.value)} /></label>
          <label className="field">Your name<input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        </div>
        <div className="frow">
          <label className="field">Time zone<select className="input" value={zone} disabled={!isAdmin} onChange={(e) => setZone(e.target.value)}>{TIMEZONES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><small>Automations run at their set time in this zone.</small></label>
          <label className="field">Week starts on<select className="input" value={week} disabled={!isAdmin} onChange={(e) => setWeek(e.target.value)}><option>Sunday</option><option>Monday</option></select></label>
        </div>
        <div><button className="btn primary" type="button" onClick={save}>Save changes</button></div>
      </section>
      {isAdmin && (
        <section className="card2">
          <div className="h"><h3>Danger zone</h3><p>Deletes this workspace’s settings, automations, drafts, DMs and analytics, and starts setup again. Nothing is removed from Discord, and your account stays.</p></div>
          <div><button className="btn" type="button" style={{ color: "var(--color-danger)" }} onClick={() => setConfirm(true)}>Delete workspace</button></div>
        </section>
      )}
      {confirm && (
        <Dialog title="Delete this workspace?" onClose={() => setConfirm(false)} actions={<><button className="btn" type="button" onClick={() => setConfirm(false)}>Keep it</button><button className="btn primary" type="button" onClick={() => { setConfirm(false); resetWorkspace(); }}>Delete workspace</button></>}>
          <p className="muted" style={{ fontSize: "var(--text-small)" }}>Everything saved for this workspace is deleted and can’t be brought back. Channels and messages in Discord stay as they are.</p>
        </Dialog>
      )}
    </>
  );
}

function Bot() {
  const { ws, guild, cfg, botName, botAvatar, channels, members, conn, discordInfo, saveWs, saveCfg, requestWait, checkDiscord, toast, user, isAdmin } = useApp();
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
    toast(r.result.created.length ? `${r.result.created.length} channels created in ${guild.guildName}. Point automations at them in Channels.` : "Those channels already exist. Nothing was created.");
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
  const { ws, crmName, shops, shop, setShop, cfg, saveCfg, refresh, toast, isAdmin } = useApp();
  const pref = (k, v) => saveCfg({ ...cfg, [k]: v }, { sync: false }).then((ok) => ok && toast("Saved"));
  return (
    <>
      <section className="card2">
        <div className="h"><h3>Connected CRM</h3></div>
        <div className="hint warn"><Ico name="plug" /><div>Kreo doesn’t have a live connection to {crmName} yet. Sales numbers, videos, products and creator contact details are <b>sample data</b> generated by the server, and the key you entered in setup wasn’t stored. Everything from Discord (members, activity, DMs, posts) is real.</div></div>
        <div className="dl">
          <div><span className="k">Provider</span><span className="v">{crmName}</span><span className="pill line">Sample data</span></div>
          <div><span className="k">Shop</span><span className="v">{shops.length > 1 ? <select className="input" style={{ height: 34 }} value={shop?.id || ""} disabled={!isAdmin} onChange={(e) => setShop(e.target.value)}>{shops.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.region.toUpperCase()}</option>)}</select> : shop?.name || "—"}</span><span /></div>
          <div><span className="k">Access</span><span className="v">Read-only</span><button className="btn sm ghost" type="button" onClick={() => { refresh(); toast("Reloaded CRM data"); }}>Reload</button></div>
        </div>
        <div className="sec-t" style={{ margin: 0 }}>Other sources</div>
        <div className="crms" style={{ margin: 0 }}>{CRMS.filter((c) => c.id !== ws.crm?.id).map((x) => <div key={x.id} className="crm" style={{ cursor: "default" }}><span className="mk">{x.mono}</span><b>{x.name}</b><span>{x.reads}. Not available yet.</span></div>)}</div>
      </section>
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
