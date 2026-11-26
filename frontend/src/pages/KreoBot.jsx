import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../context/app.js";
import { api } from "../services/api.js";
import { Empty, Ico, PageHead, Skel } from "../components/ui.jsx";

const when = (iso) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const ID_RE = /^\d{17,20}$/;

/**
 * The official KREO bot (platform admins only). It is separate from each brand's community bot:
 * its own Discord application, token, identity, connection and DM history.
 */
export default function KreoBot() {
  const { conn } = useApp();
  const [st, setSt] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      setSt(await api("GET", "/kreo/status"));
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => { if (conn.platformAdmin) load(); }, [conn.platformAdmin, load]);
  // Keep the connection badge honest while the page is open.
  useEffect(() => { if (!st?.configured) return undefined; const t = setInterval(load, 15_000); return () => clearInterval(t); }, [st?.configured, load]);

  const act = async (action) => {
    setBusy(action);
    try {
      setSt(await api("POST", "/kreo/connection", { action }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  };

  if (!conn.platformAdmin) return <Empty title="Not available">This page is for the platform’s admins.</Empty>;
  if (error && !st) return <><PageHead title="KREO bot" /><Empty title="Couldn’t load the KREO bot">{error.message}</Empty></>;
  if (!st) return <><PageHead title="KREO bot" /><Skel n={3} /></>;

  const g = st.gateway;
  const state = !st.configured ? ["line", "Not set up"] : st.error && !st.bot ? ["rose", "Token rejected"] : g.connected ? ["good", "Online"] : g.off ? ["line", "Live connection off"] : g.running ? ["line", "Connecting…"] : ["rose", "Disconnected"];

  return (
    <>
      <PageHead title="KREO bot" desc="The platform’s own Discord bot. It runs separately from each brand’s community bot: its own identity, connection and DMs." />
      <div className="kb">
        <section className="card2">
          <div className="kb-id">
            <div className="kb-av">{st.bot?.avatar ? <img src={st.bot.avatar} alt="" /> : <b>K</b>}</div>
            <div style={{ minWidth: 0 }}>
              <h3>{st.bot?.name || "KREO"} {st.bot && <span className="pill">APP</span>}</h3>
              <span className="muted">{st.bot ? `Bot id ${st.bot.id}` : "No bot token yet"}</span>
            </div>
            <span className={"pill " + state[0]} style={{ marginLeft: "auto" }}>{state[0] === "good" && <i className="dot-ok" />}{state[1]}</span>
          </div>
          {st.error && <p className="kb-err">{st.error}</p>}
          {!st.configured ? <Setup /> : (
            <>
              <div className="kb-facts">
                <div><span>Live events</span><b>{g.connected ? `Connected${g.since ? " since " + when(g.since) : ""}` : g.error || (g.off ? "Off (KREO_DISCORD_GATEWAY=off)" : "Not connected")}</b></div>
                <div><span>Server Members intent</span><b>{st.intents?.members ? "On" : "Off: pick members by user id"}</b></div>
                <div><span>Servers</span><b>{st.guilds.length}</b></div>
              </div>
              <div className="kb-row">
                {st.inviteUrl && <a className="btn primary sm" href={st.inviteUrl} target="_blank" rel="noreferrer"><Ico name="plus" />Add KREO to a server</a>}
                {g.connected || g.running
                  ? <button className="btn sm" type="button" disabled={!!busy} onClick={() => act("disconnect")}>{busy === "disconnect" ? "Disconnecting…" : "Disconnect"}</button>
                  : <button className="btn sm" type="button" disabled={!!busy || g.off} onClick={() => act("connect")}><Ico name="plug" />{busy === "connect" ? "Connecting…" : "Connect"}</button>}
                <button className="btn sm ghost" type="button" disabled={!!busy || g.off} onClick={() => act("restart")}><Ico name="redo" />{busy === "restart" ? "Restarting…" : "Restart"}</button>
                <button className="btn sm ghost" type="button" onClick={load}>Refresh</button>
              </div>
              <small className="muted">Connecting, disconnecting or restarting KREO doesn’t affect the brand bots. The invite asks only for View Channels, Send Messages, Embed Links and Read Message History (permissions {st.permissions}): KREO talks in DMs and can’t change a server.</small>
            </>
          )}
        </section>

        {st.configured && st.bot && (
          <section className="card2">
            <div className="h"><h3>Servers</h3><p>Discord servers KREO has joined. It can DM people who share one of these servers with it.</p></div>
            {st.guilds.length ? (
              <ul className="kb-guilds">
                {st.guilds.map((x) => (
                  <li key={x.id}>
                    <span className="kb-gi">{x.icon ? <img src={x.icon} alt="" /> : x.name.slice(0, 2).toUpperCase()}</span>
                    <div><b>{x.name}</b><span>{x.members != null ? `${x.members} members · ` : ""}{x.id}</span></div>
                  </li>
                ))}
              </ul>
            ) : <Empty title="Not in any server yet">Use “Add KREO to a server” above and pick your testing server.</Empty>}
          </section>
        )}

        {st.configured && st.bot && st.guilds.length > 0 && <TestDm guilds={st.guilds} botName={st.bot.name} botAvatar={st.bot.avatar} />}
      </div>
    </>
  );
}

function Setup() {
  return (
    <ol className="kb-steps">
      <li>In the <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">Discord Developer Portal</a>, create a <b>new application</b> named KREO (separate from the brand bot’s application) and give it the KREO logo.</li>
      <li>Open <b>Bot</b>, press <b>Reset Token</b> and copy it. Switch on <b>Server Members Intent</b>.</li>
      <li>Add <code>KREO_DISCORD_BOT_TOKEN</code> and <code>KREO_DISCORD_CLIENT_ID</code> (General Information → Application ID) to the backend’s environment, then restart the backend.</li>
    </ol>
  );
}

function TestDm({ guilds, botName, botAvatar }) {
  const { toast } = useApp();
  const [guildId, setGuildId] = useState(guilds[0].id);
  const [list, setList] = useState(undefined); // undefined loading · null no intent · [] members
  const [filter, setFilter] = useState("");
  const [userId, setUserId] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [btn, setBtn] = useState({ label: "", url: "" });
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [errField, setErrField] = useState(null);
  const [convs, setConvs] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [thread, setThread] = useState(null);

  useEffect(() => {
    let live = true;
    setList(undefined);
    setUserId("");
    api("GET", `/kreo/guilds/${guildId}/members`).then((r) => live && setList(r.members)).catch((e) => { if (live) { setList(null); toast(e.message); } });
    return () => { live = false; };
  }, [guildId, toast]);

  const loadConvs = useCallback(() => api("GET", "/kreo/conversations").then((r) => setConvs(r.conversations)).catch(() => {}), []);
  const loadThread = useCallback((id) => (id ? api("GET", `/kreo/conversations/${id}`).then((r) => setThread(r.messages)).catch(() => {}) : null), []);
  useEffect(() => { loadConvs(); const t = setInterval(loadConvs, 8000); return () => clearInterval(t); }, [loadConvs]);
  useEffect(() => { setThread(null); loadThread(openId); const t = setInterval(() => loadThread(openId), 5000); return () => clearInterval(t); }, [openId, loadThread]);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (list || []).filter((m) => !f || m.name.toLowerCase().includes(f) || m.user.toLowerCase().includes(f)).slice(0, 100);
  }, [list, filter]);
  const picked = (list || []).find((m) => m.id === userId);

  const send = async () => {
    setSending(true);
    setResult(null);
    setErrField(null);
    try {
      const r = await api("POST", "/kreo/dm", { guildId, userId, text, title, buttonLabel: btn.label, buttonUrl: btn.url });
      setResult(r);
      if (r.ok) setText("");
      loadConvs();
      setOpenId(r.to.id);
      loadThread(r.to.id);
    } catch (e) {
      setErrField(e.field || null);
      setResult({ ok: false, result: e.message });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <section className="card2">
        <div className="h"><h3>Send a test DM</h3><p>Sent from KREO, so it lands in its own DM conversation, separate from the brand bot’s. Discord delivers it only if the person shares a server with KREO and allows DMs from server members.</p></div>
        <div className="frow">
          <label className="field">Server
            <select className="input" value={guildId} onChange={(e) => setGuildId(e.target.value)}>{guilds.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          </label>
          {list === null ? (
            <label className="field">Member’s Discord user id
              <input className={"input" + (errField === "userId" ? " bad" : "")} inputMode="numeric" placeholder="e.g. 712345678901234567" value={userId} onChange={(e) => setUserId(e.target.value.replace(/\D/g, ""))} />
              <small>KREO can’t list members until Server Members Intent is on. In Discord, turn on Developer Mode, then right-click a member → Copy User ID.</small>
            </label>
          ) : (
            <label className="field">Member
              <input className="input" placeholder={list === undefined ? "Loading members…" : `Search ${list.length} members`} value={filter} disabled={list === undefined} onChange={(e) => setFilter(e.target.value)} />
            </label>
          )}
        </div>
        {Array.isArray(list) && (
          <div className="kb-people" role="listbox" aria-label="Members">
            {shown.map((m) => (
              <button key={m.id} type="button" role="option" aria-selected={userId === m.id} className={userId === m.id ? "on" : ""} onClick={() => setUserId(m.id)}>
                <span className="kb-pa">{m.avatar ? <img src={m.avatar} alt="" /> : m.name.slice(0, 1).toUpperCase()}</span>
                <span><b>{m.name}</b><small>@{m.user}</small></span>
              </button>
            ))}
            {!shown.length && <span className="muted" style={{ padding: 8 }}>{list.length ? "No one matches." : "No members to show."}</span>}
          </div>
        )}
        <div className="kb-compose">
          <div style={{ display: "grid", gap: 12 }}>
            <label className="field">Title <small>Optional. With a title, the message is sent as a card like the preview.</small>
              <input className="input" maxLength={256} placeholder="e.g. Welcome to KREO" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="field">Message
              <textarea className={"input" + (errField === "text" ? " bad" : "")} maxLength={title ? 4000 : 2000} placeholder="Write the test message…" value={text} onChange={(e) => setText(e.target.value)} />
            </label>
            <div className="frow">
              <label className="field">Button label (optional)<input className="input" maxLength={80} placeholder="Open KREO" value={btn.label} onChange={(e) => setBtn({ ...btn, label: e.target.value })} /></label>
              <label className="field">Button link<input className={"input" + (errField === "buttonUrl" ? " bad" : "")} placeholder="https://…" value={btn.url} onChange={(e) => setBtn({ ...btn, url: e.target.value.trim() })} /></label>
            </div>
          </div>
          <div className="kb-preview" aria-label="Preview">
            <span className="kb-prev-l">Preview in {picked ? picked.name + "’s" : "their"} DMs</span>
            <div className="kb-msg">
              <span className="kb-mav">{botAvatar ? <img src={botAvatar} alt="" /> : "K"}</span>
              <div style={{ minWidth: 0 }}>
                <div className="kb-mh"><b>{botName}</b><span className="kb-app">APP</span><small>Today</small></div>
                {title ? <div className="kb-embed"><b>{title}</b><p>{text || "Your message…"}</p></div> : <p className="kb-txt">{text || "Your message…"}</p>}
                {btn.url && <span className="kb-btn">{btn.label || "Open"} <Ico name="external" /></span>}
              </div>
            </div>
          </div>
        </div>
        <div className="kb-row">
          <button className="btn primary" type="button" disabled={sending || !text.trim() || !ID_RE.test(userId)} onClick={send}><Ico name="send" />{sending ? "Sending…" : "Send from KREO"}</button>
          {result && <span className={"kb-result " + (result.ok ? "ok" : "bad")} role="status"><Ico name={result.ok ? "check" : "x"} />{result.result}</span>}
        </div>
      </section>

      <section className="card2">
        <div className="h"><h3>KREO conversations</h3><p>Messages KREO sent and replies people sent back to KREO. Kept apart from the brand bot’s DMs.</p></div>
        {!convs ? <Skel n={2} /> : !convs.length ? <Empty title="No conversations yet">Send a test DM above. Replies to KREO show up here.</Empty> : (
          <div className="kb-convs">
            <ul>
              {convs.map((c) => (
                <li key={c.userId}>
                  <button type="button" className={openId === c.userId ? "on" : ""} onClick={() => setOpenId(c.userId)}>
                    <b>{c.name || c.userId}</b>
                    <span>{c.last.direction === "in" ? "" : c.last.status === "failed" ? "Not delivered · " : "You: "}{c.last.text}</span>
                    <small>{when(c.last.at)}{c.replies ? ` · ${c.replies} repl${c.replies === 1 ? "y" : "ies"}` : ""}</small>
                  </button>
                </li>
              ))}
            </ul>
            <div className="kb-thread">
              {!openId ? <span className="muted">Pick a conversation.</span> : !thread ? <Skel n={2} /> : thread.map((m) => (
                <div key={m.id} className={"bub " + (m.direction === "in" ? "ai" : "me") + (m.status === "failed" ? " failed" : "")}>
                  {m.title && <b style={{ display: "block" }}>{m.title}</b>}
                  {m.text}
                  <small className="kb-meta">{when(m.at)}{m.direction === "out" ? ` · ${m.status === "failed" ? "not delivered" : "sent"}${m.sentBy ? " by " + m.sentBy : ""}` : " · reply"}</small>
                  {m.error && <small className="kb-meta">{m.error}</small>}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
