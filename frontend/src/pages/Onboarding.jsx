import { useEffect, useRef, useState } from "react";
import { useApp } from "../context/app.js";
import { useCommunity, useCreators } from "../hooks/useCommunity.js";
import { ago, fmtTime, initials } from "../lib/format.js";
import { BotAvatar, Empty, Ico, PageHead, Sw, Tabs } from "../components/ui.jsx";

const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;
const answered = (t) => t.msgs.some((m) => m.from === "c");
const STATUS = {
  done: ["Onboarded", "good"], needs: ["Needs reply", "rose"], progress: ["In progress", ""], closed: ["DM not delivered", "line"],
};
const FILTERS = {
  all: ["All conversations", () => true],
  unread: ["Unread", (t) => t.unread],
  needs: ["Needs a reply", (t) => t.status === "needs"],
  done: ["Onboarded", (t) => t.status === "done"],
  waiting: ["No reply yet", (t) => t.status === "progress" && !answered(t)],
};

export default function Onboarding() {
  const { view, setView, dms, cfg, saveCfg, toast, conn, isAdmin } = useApp();
  const tab = view.ob || "inbox";
  const unread = dms.filter((d) => d.unread).length;
  const on = cfg.dmNew !== false;
  return (
    <>
      <PageHead title="Onboarding & DMs" desc="Every new member gets your welcome DM. All conversations live here, and you can reply as the bot.">
        <span className="pill line">{on ? "DMs on" : "DMs paused"}</span>
        <Sw checked={on} disabled={!isAdmin} label="DM new members" onChange={async (v) => { if (await saveCfg({ ...cfg, dmNew: v }, { sync: false })) toast(v ? "New members get the welcome DM" : "Welcome DMs paused"); }} />
      </PageHead>
      {conn.gateway.members === false && <div className="hint warn" style={{ marginBottom: 14 }}><Ico name="shield" /><div>Discord isn’t telling the bot when someone joins, so nobody is welcomed automatically. In the Discord Developer Portal open your bot → Bot → Privileged Gateway Intents, turn on <b>Server Members Intent</b>, then restart the backend. You can still welcome members by hand under Responses.</div></div>}
      <Tabs value={tab} onChange={(ob) => setView({ ob })} tabs={[["inbox", "Inbox", unread > 0 && <span key="n" className="pill rose">{unread}</span>], ["questions", "Questions"], ["responses", "Responses"]]} />
      {tab === "inbox" && <Inbox />}
      {tab === "questions" && <Questions />}
      {tab === "responses" && <Responses />}
    </>
  );
}

function Inbox() {
  const { dms, view, setView, ob, cfg, botName, request, requestWait, toast, money, openCreator, canEdit } = useApp();
  const { rows } = useCreators();
  const [f, setF] = useState("all");
  const [q, setQ] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const box = useRef(null);
  const ql = q.toLowerCase();
  const list = dms.filter(FILTERS[f][1]).filter((t) => !ql || [t.name, t.user, t.tiktok].join(" ").toLowerCase().includes(ql) || t.msgs.some((m) => m.text.toLowerCase().includes(ql)));
  const cur = dms.find((t) => t.userId === view.dm) || list[0] || null;
  const curId = cur?.userId, isUnread = cur?.unread, count = cur?.msgs.length;

  useEffect(() => { if (curId && isUnread) request("dm_read", { userId: curId }); }, [curId, isUnread, request]);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [curId, count]);

  if (!dms.length) return <div className="tile"><Empty title="No conversations yet">When someone joins your server, the bot DMs them your welcome message and their replies appear here. To try it now, open Responses and send the welcome DM to a member.</Empty></div>;

  const cr = cur && rows.find((r) => r.member?.id === cur.userId);
  const send = async () => {
    const v = text.trim();
    if (!v || sending) return;
    setSending(true);
    const r = await requestWait("dm", { userId: cur.userId, text: v });
    setSending(false);
    if (!r.ok) return toast(r.error || "Couldn’t send the DM.");
    setText("");
    toast("Sent as " + botName);
  };
  const mark = (t) => {
    if (cfg.waDetect === false) return t;
    const m = t.match(PHONE_RE);
    return m ? <>{t.slice(0, m.index)}<mark>{m[1]}</mark>{t.slice(m.index + m[1].length)}</> : t;
  };

  return (
    <div className="inbox">
      <div className="ib-list">
        <div className="ib-f">
          <input className="input" placeholder="Search DMs" aria-label="Search DMs" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" aria-label="Filter" value={f} onChange={(e) => setF(e.target.value)}>{Object.entries(FILTERS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
        </div>
        <div className="convs">
          {list.map((t) => {
            const last = t.msgs[t.msgs.length - 1];
            return (
              <button key={t.userId} type="button" className={"conv" + (t.userId === curId ? " on" : "")} onClick={() => setView({ dm: t.userId })}>
                <span className="cav">{initials(t.name)}</span>
                <div style={{ minWidth: 0 }}><b>{t.name}</b><span className="pv">{last ? (last.from === "bot" ? "You: " : "") + last.text : t.error || "Not delivered"}</span></div>
                <span className="tm">{ago(t.updatedAt)}{t.unread && <i className="unread" />}</span>
              </button>
            );
          })}
          {!list.length && <Empty title="No conversations match" />}
        </div>
      </div>
      {cur && (
        <>
          <div className="thread">
            <div className="th-h"><span className="cav r">{initials(cur.name)}</span><div style={{ minWidth: 0 }}><b>{cur.name}</b><span>@{cur.user} · DM with {botName}</span></div><div style={{ marginLeft: "auto" }}><span className={"pill " + STATUS[cur.status][1]}>{cur.status === "progress" && !answered(cur) ? "No reply yet" : STATUS[cur.status][0]}</span></div></div>
            <div className="msgs" ref={box}>
              {cur.msgs.map((m, i) => (
                <div key={i} className="bubrow" style={{ alignItems: m.from === "bot" ? "flex-end" : "flex-start" }}>
                  <div className={"bub " + (m.from === "bot" ? "me" : "ai")}>{m.from === "c" ? mark(m.text) : m.text}<span className="when">{fmtTime(m.at)}{m.by === "team" ? " · sent by your team" : ""}</span></div>
                  {m.from === "c" && cfg.waDetect !== false && PHONE_RE.test(m.text) && <span className="det"><Ico name="wa" />Phone number found and saved to profile</span>}
                </div>
              ))}
              {!cur.msgs.length && <Empty title="The welcome DM wasn’t delivered">{cur.error}</Empty>}
            </div>
            <form className="compose" onSubmit={(e) => { e.preventDefault(); send(); }}>
              <textarea className="input" aria-label="Reply" placeholder={`Reply as ${botName}…`} value={text} disabled={!canEdit || sending} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
              <button className="btn primary" type="submit" disabled={!canEdit || sending || !text.trim()}><Ico name="send" />{sending ? "Sending…" : "Send"}</button>
            </form>
          </div>
          <aside className="ib-side">
            <div><div className="sec-t">Creator</div><div className="dl">
              <div><span className="k">Discord</span><span className="v">@{cur.user}</span><span /></div>
              <div><span className="k">TikTok</span><span className="v">{cur.tiktok ? "@" + cur.tiktok : "—"}</span><span /></div>
              <div><span className="k">Email</span><span className="v">{cr?.email || "—"}</span>{cr?.email ? <span className="src">CRM</span> : <span />}</div>
              <div><span className="k">Phone</span><span className="v">{cr?.phone || "—"}</span>{cr?.phone ? <span className="src">CRM</span> : <span />}</div>
              <div><span className="k">WhatsApp</span><span className="v">{cr?.wa || "—"}</span>{cr?.wa ? <span className={"src" + (cr.waSrc === "dm" ? " dm" : "")}>{cr.waSrc === "dm" ? "DM" : "CRM"}</span> : <span />}</div>
              <div><span className="k">GMV</span><span className="v">{cr?.inCrm ? money(cr.gmv, true) : "—"}</span><span /></div>
            </div></div>
            <div><div className="sec-t">Onboarding</div><div className="ob-steps">
              {ob.questions.map((q2, i) => { const ok = q2 in (cur.answers || {}) || (cur.status !== "progress" && cur.status !== "closed" && i < cur.step); return <div key={i}><span className={"s" + (ok ? " ok" : "")}>{ok && <Ico name="check" />}</span><span>{q2}</span></div>; })}
            </div></div>
            {cr && <button className="btn" type="button" onClick={() => openCreator(cr.key)}><Ico name="users" />Open creator profile</button>}
          </aside>
        </>
      )}
    </div>
  );
}

function Questions() {
  const { ob, saveOb, cfg, saveCfg, guild, botName, toast, isAdmin } = useApp();
  const [welcome, setWelcome] = useState(ob.welcome);
  const [qs, setQs] = useState(ob.questions);
  const dirty = welcome !== ob.welcome || JSON.stringify(qs) !== JSON.stringify(ob.questions);
  const save = async () => {
    const clean = qs.map((q) => q.trim()).filter(Boolean);
    if (await saveOb({ welcome: welcome.trim(), questions: clean })) { setQs(clean); toast("Welcome DM saved"); }
  };
  const pref = (k, v) => saveCfg({ ...cfg, [k]: v }, { sync: false }).then((ok) => ok && toast("Saved"));
  return (
    <div className="bento">
      <section className="tile s7">
        <div className="th"><h2>Welcome DM</h2></div>
        <label className="field">Opening message<textarea className="input" value={welcome} disabled={!isAdmin} onChange={(e) => setWelcome(e.target.value)} /><small>Use {"{first_name}"} and {"{server}"}.</small></label>
        <div className="th" style={{ marginTop: 18 }}><h2>Questions</h2><span className="muted" style={{ fontSize: "var(--text-micro)" }}>{qs.length} of 6 · asked one at a time</span></div>
        <div style={{ display: "grid", gap: 8 }}>
          {qs.map((q, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="disc">{i + 1}</span>
              <input className="input" aria-label={`Question ${i + 1}`} value={q} disabled={!isAdmin} onChange={(e) => setQs(qs.map((x, j) => (j === i ? e.target.value : x)))} />
              <button className="iconbtn" type="button" aria-label="Remove question" disabled={!isAdmin} onClick={() => setQs(qs.filter((_, j) => j !== i))}><Ico name="x" /></button>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button className="btn sm" type="button" disabled={!isAdmin || qs.length >= 6} onClick={() => setQs([...qs, ""])}><Ico name="plus" />Add question</button>
          <button className="btn sm primary" type="button" disabled={!isAdmin || !dirty} onClick={save}>Save changes</button>
        </div>
        <p className="muted" style={{ fontSize: "var(--text-micro)", marginTop: 8 }}>A question with “TikTok” or “handle” in it links the member to their TikTok account.</p>
        <div className="trow" style={{ marginTop: 16 }}><div><b>Find phone numbers in replies</b><span>Saves any number a creator shares in DMs to their profile as their WhatsApp</span></div><Sw checked={cfg.waDetect !== false} disabled={!isAdmin} label="Find phone numbers" onChange={(v) => pref("waDetect", v)} /></div>
        <div className="trow"><div><b>Remind after 24 hours of silence</b><span>One friendly nudge, then we stop</span></div><Sw checked={cfg.reminders !== false} disabled={!isAdmin} label="Reminders" onChange={(v) => pref("reminders", v)} /></div>
      </section>
      <section className="tile s5">
        <div className="th"><h2>Preview</h2><span className="muted" style={{ fontSize: "var(--text-micro)" }}>How the DM reads</span></div>
        <div className="dc"><div className="chan"><Ico name="chat" />Direct message</div><div className="msg"><div className="av"><BotAvatar /></div><div style={{ minWidth: 0, display: "grid", gap: 8 }}>
          <div className="who">{botName} <small>APP</small></div>
          <div>{welcome.replace(/\{(first_name|name)\}/g, "Lena").replace(/\{(server|brand)\}/g, guild?.guildName || "your server")}</div>
          {qs.filter(Boolean).map((q, i) => <div key={i}><b style={{ color: "var(--color-discord-head)" }}>{i + 1}.</b> {q}</div>)}
        </div></div></div>
      </section>
    </div>
  );
}

function Responses() {
  const { dms, ob, setView, requestWait, toast, canEdit } = useApp();
  const { members } = useCommunity();
  const [busy, setBusy] = useState("");
  const fresh = members.filter((m) => !m.thread);
  const welcome = async (m) => {
    setBusy(m.id);
    const r = await requestWait("welcome", { userId: m.id });
    setBusy("");
    toast(r.ok ? `Welcome DM sent to ${m.name}` : r.error || "Couldn’t send the DM.");
  };
  const cut = (q) => (q.length > 28 ? q.slice(0, 28) + "…" : q);
  return (
    <>
      <div className="tblwrap"><table className="tbl">
        <thead><tr><th>Member</th><th>Status</th>{ob.questions.map((q) => <th key={q}>{cut(q)}</th>)}</tr></thead>
        <tbody>
          {dms.map((t) => (
            <tr key={t.userId} onClick={() => setView({ ob: "inbox", dm: t.userId })}>
              <td><div className="who"><span className="cav">{initials(t.name)}</span><div><b>{t.name}</b><span>{t.tiktok ? "@" + t.tiktok + " · " : ""}{ago(t.updatedAt)}</span></div></div></td>
              <td><span className={"pill " + (t.status === "done" || t.status === "needs" ? "good" : t.status === "closed" ? "line" : "")}>{t.status === "done" || t.status === "needs" ? "Done" : t.status === "closed" ? "Not delivered" : answered(t) ? "In progress" : "No reply"}</span></td>
              {ob.questions.map((q) => <td key={q}>{t.answers?.[q] || <span className="muted">—</span>}</td>)}
            </tr>
          ))}
          {!dms.length && <tr><td colSpan={2 + ob.questions.length}><Empty title="No responses yet">Answers appear here as members reply to the welcome DM.</Empty></td></tr>}
        </tbody>
      </table></div>
      {fresh.length > 0 && (
        <section className="card2" style={{ marginTop: 16 }}>
          <div className="h"><h3>Not welcomed yet</h3><p>{fresh.length} member{fresh.length === 1 ? "" : "s"} joined before the bot was listening. Send them the welcome DM now.</p></div>
          {fresh.slice(0, 50).map((m) => (
            <div key={m.id} className="trow"><div style={{ display: "flex", gap: 10, alignItems: "center" }}><span className="cav">{initials(m.name)}</span><div><b>{m.name}</b><span>@{m.user} · joined {m.joined}</span></div></div><button className="btn sm" type="button" disabled={!canEdit || !!busy} onClick={() => welcome(m)}>{busy === m.id ? "Sending…" : "Send welcome DM"}</button></div>
          ))}
        </section>
      )}
    </>
  );
}
