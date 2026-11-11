import { useState } from "react";
import { useApp } from "../context/app.js";
import { AUTOS } from "../lib/constants.js";
import { fmtTime } from "../lib/format.js";
import { ChanSelect, Empty, Hero } from "../components/ui.jsx";

export default function Setup() {
  const { guild: g, channels, allow, autos, cfg, saveCfg, request, toast } = useApp();
  const used = allow?.channels || [];
  const [form, setForm] = useState(() => ({ modChannel: cfg.modChannel, approverRole: cfg.approverRole, tone: cfg.tone }));
  const [syncing, setSyncing] = useState(false);

  const resync = async () => {
    setSyncing(true);
    if (await request("sync", {})) toast("Asked Claude to re-check your server");
    setTimeout(() => setSyncing(false), 2500);
  };
  const applyAllow = async () => {
    if (await request("allowlist", {})) toast("Asked Claude to apply the allowlist");
  };
  const submit = async (e) => {
    e.preventDefault();
    if (await saveCfg({ ...cfg, ...form })) toast("Saved");
  };

  return (
    <>
      <Hero eyebrow={g ? g.guildName : "Discord"} title="Bot & channels" lede="The server the bot runs in, where it’s allowed to post and how it sounds." />
      <div className="grid">
        <section className="card">
          <div className="head"><h2>Server</h2><button className="btn sm" onClick={resync} disabled={syncing}>{syncing ? "Syncing…" : "Re-sync From Discord"}</button></div>
          {g ? (
            <div className="rows">
              <div><span className="grow">Server</span><b>{g.guildName}</b></div>
              <div><span className="grow">Bot</span><b>{g.botName}</b></div>
              <div><span className="grow">Text channels</span><b>{g.channels.length}</b></div>
              <div><span className="grow">Roles</span><b>{g.roles.length}</b></div>
              <div><span className="grow">Last checked</span><b>{fmtTime(g.syncedAt)}</b></div>
            </div>
          ) : <Empty>No server connected. Run the <a href="#welcome">setup guide</a>.</Empty>}
        </section>

        <section className="card">
          <div className="head">
            <h2>Allowlist</h2>
            <span className={"pill" + (allow?.syncedAt ? " good" : "")}>{allow?.syncedAt ? "Applied " + fmtTime(allow.syncedAt) : "Waiting for Claude"}</span>
          </div>
          <p className="muted" style={{ marginTop: 0 }}>The bot only posts in these channels. The list updates when you change automation channels.</p>
          {used.length ? (
            <div className="rows">{used.map((c) => <div key={c.id}><span className="grow"><b>#{c.name}</b></span><code>{c.id}</code></div>)}</div>
          ) : <Empty>No channels chosen yet.</Empty>}
          {used.length > 0 && !allow?.syncedAt && <button className="btn sm" style={{ marginTop: 10 }} onClick={applyAllow}>Apply Allowlist Now</button>}
        </section>

        <section className="card span">
          <div className="head"><h2>Bot voice</h2></div>
          <form className="form" onSubmit={submit}>
            <label className="field"><span>Mod channel</span><ChanSelect value={form.modChannel} onChange={(v) => setForm({ ...form, modChannel: v })} /><small>Test posts and flagged messages go here</small></label>
            <label className="field">
              <span>Approver role</span>
              <select value={form.approverRole} onChange={(e) => setForm({ ...form, approverRole: e.target.value })}>
                <option value="">Anyone in the mod channel</option>
                {(g?.roles || []).map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className="field span"><span>Tone of voice</span><textarea value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })} /></label>
            <div className="span"><button className="btn primary">Save</button></div>
          </form>
        </section>

        <section className="card span">
          <div className="head"><h2>Channels in {g ? g.guildName : "the server"}</h2><span className="muted">{channels.length} text channels with their IDs</span></div>
          {!channels.length ? <Empty>No channels yet.</Empty> : (
            <div className="tablebox">
              <table>
                <thead><tr><th>Channel</th><th>Category</th><th>Bot access</th><th>Used by</th><th>Channel ID</th></tr></thead>
                <tbody>
                  {channels.map((c) => {
                    const by = AUTOS.filter((a) => autos[a.key].channel === c.id).map((a) => a.name);
                    if (cfg.modChannel === c.id) by.push("Mod channel");
                    return (
                      <tr key={c.id}>
                        <td><b>#{c.name}</b></td>
                        <td className="muted">{c.category}</td>
                        <td>{c.canPost === false ? <span className="pill bad">Can’t see</span> : c.canPost ? <span className="pill good">Can post</span> : <span className="muted">Unknown</span>}</td>
                        <td>{by.length ? <span className="checks">{by.map((x) => <span key={x} className="pill">{x}</span>)}</span> : <span className="muted">—</span>}</td>
                        <td><code>{c.id}</code></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
