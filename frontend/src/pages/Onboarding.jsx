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
  const [linking, setLinking] = useState(null); // draft TikTok handle while editing, or null
  const [busy, setBusy] = useState("");
  const box = useRef(null);
  const ql = q.toLowerCase();
  const list = dms.filter(FILTERS[f][1]).filter((t) => !ql || [t.name, t.user, t.tiktok].join(" ").toLowerCase().includes(ql) || t.msgs.some((m) => m.text.toLowerCase().includes(ql)));
  const cur = dms.find((t) => t.userId === view.dm) || list[0] || null;
  const curId = cur?.userId, isUnread = cur?.unread, count = cur?.msgs.length;

  useEffect(() => { if (curId && isUnread) request("dm_read", { userId: curId }); }, [curId, isUnread, request]);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [curId, count]);
  useEffect(() => setLinking(null), [curId]);

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
  const act = async (type, payload, ok) => {
    setBusy(type);
    const r = await requestWait(type, { userId: cur.userId, ...payload });
    setBusy("");
    if (!r.ok) { toast(r.error || "That didn’t work. Try again."); return false; }
    toast(ok);
    return true;
  };
  const saveLink = async () => {
    const h = (linking || "").trim();
    if (await act("dm_link", { tiktok: h }, h ? `Linked to @${h.replace(/^@/, "").toLowerCase()}` : "TikTok unlinked")) setLinking(null);
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
            <div className="th-h"><span className="cav r">{initials(cur.name)}</span><div style={{ minWidth: 0 }}><b>{cur.name}</b><span>@{cur.user} · DM with {botName}</span></div><div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
              {cur.status === "needs" && <button className="btn sm ghost" type="button" disabled={!canEdit || !!busy} onClick={() => act("dm_status", { status: "done" }, "Marked as resolved")}><Ico name="check" />Resolve</button>}
              {cur.status === "done" && answered(cur) && <button className="btn sm ghost" type="button" disabled={!canEdit || !!busy} onClick={() => act("dm_status", { status: "needs" }, "Reopened")}>Reopen</button>}
              {cur.status === "closed" && <button className="btn sm" type="button" disabled={!canEdit || !!busy} onClick={() => act("welcome", {}, "Welcome DM sent again")}><Ico name="redo" />{busy === "welcome" ? "Sending…" : "Retry welcome DM"}</button>}
              <span className={"pill " + STATUS[cur.status][1]}>{cur.status === "progress" && !answered(cur) ? "No reply yet" : STATUS[cur.status][0]}</span>
            </div></div>
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
              {linking === null ? (
                <div><span className="k">TikTok</span><span className="v">{cur.tiktok ? "@" + cur.tiktok : <span className="muted">Not linked</span>}{cur.linkedBy === "team" && <span className="muted" style={{ fontSize: "var(--text-micro)" }}> · set by your team</span>}</span>{canEdit ? <button className="btn sm ghost" type="button" aria-label="Edit TikTok handle" onClick={() => setLinking(cur.tiktok ? "@" + cur.tiktok : "")}><Ico name="edit" /></button> : <span />}</div>
              ) : (
                <div style={{ gridTemplateColumns: "1fr" }}>
                  <span className="k">TikTok handle</span>
                  <input className="input" style={{ height: 34 }} autoFocus placeholder="@handle" value={linking} disabled={busy === "dm_link"} onChange={(e) => setLinking(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveLink(); if (e.key === "Escape") setLinking(null); }} />
                  <div style={{ display: "flex", gap: 6 }}><button className="btn sm primary" type="button" disabled={busy === "dm_link"} onClick={saveLink}>Save</button><button className="btn sm ghost" type="button" onClick={() => setLinking(null)}>Cancel</button></div>
                </div>
              )}
              <div><span className="k">Email</span><span className="v">{cr?.email || "—"}</span>{cr?.email ? <span className="src">CRM</span> : <span />}</div>
              <div><span className="k">Phone</span><span className="v">{cr?.phone || "—"}</span>{cr?.phone ? <span className="src">CRM</span> : <span />}</div>
              <div><span className="k">WhatsApp</span><span className="v">{cr?.wa || "—"}</span>{cr?.wa ? <span className={"src" + (cr.waSrc === "dm" ? " dm" : "")}>{cr.waSrc === "dm" ? "DM" : "CRM"}</span> : <span />}</div>
              <div><span className="k">GMV</span><span className="v">{cr?.inCrm ? money(cr.gmv, true) : "—"}</span><span /></div>
            </div></div>
            <div><div className="sec-t">Onboarding</div><div className="ob-steps">
              {ob.questions.map((q2, i) => { const ok = q2 in (cur.answers || {}) || (cur.status !== "progress" && cur.status !== "closed" && i < cur.step); return <div key={i}><span className={"s" + (ok ? " ok" : "")}>{ok && <Ico name="check" />}</span><span>{q2}</span></div>; })}
            </div></div>
            {cur.roleError && <div className="hint warn"><Ico name="shield" /><div>{cur.roleError}</div></div>}
            {cur.tiktok && !cr?.inCrm && <p className="muted" style={{ fontSize: "var(--text-micro)" }}>@{cur.tiktok} has no sales in your CRM yet. If that’s a typo, fix the handle above.</p>}
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
  const [done, setDone] = useState(ob.done || "");
  const [doneRole, setDoneRole] = useState(ob.doneRole || "");
  const [notifyDone, setNotifyDone] = useState(ob.notifyDone !== false);
  const dirty = welcome !== ob.welcome || JSON.stringify(qs) !== JSON.stringify(ob.questions) || done !== (ob.done || "") || doneRole !== (ob.doneRole || "") || notifyDone !== (ob.notifyDone !== false);
  const linksTikTok = qs.some((q) => /tiktok|handle/i.test(q));
  // Roles the bot could give: real roles (not bots' own managed roles), by id.
  const roles = Object.entries(guild?.roleNames || {}).filter(([, n]) => (guild?.roles || []).includes(n));
  const save = async () => {
    const clean = qs.map((q) => q.trim()).filter(Boolean);
    if (!clean.length) return toast("Add at least one question.");
    if (await saveOb({ ...ob, welcome: welcome.trim(), questions: clean, done: done.trim(), doneRole, notifyDone })) { setQs(clean); toast("Onboarding saved"); }
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
        </div>
        <p className="muted" style={{ fontSize: "var(--text-micro)", marginTop: 8 }}>A question with “TikTok” or “handle” in it links the member to their TikTok account. If the reply isn’t a handle, the bot asks once more for just the handle.</p>
        {!linksTikTok && <div className="hint warn" style={{ marginTop: 8 }}><Ico name="plug" /><div>No question asks for a TikTok handle, so members won’t be linked to their sales. Creator tiers, sample follow-ups and Discord tags in posts need that link.</div></div>}

        <div className="th" style={{ marginTop: 18 }}><h2>When they finish</h2></div>
        <label className="field">Closing message<textarea className="input" value={done} disabled={!isAdmin} placeholder="Thanks, that’s everything. You’re all set! 🚀" onChange={(e) => setDone(e.target.value)} /><small>Sent after the last answer. Use {"{first_name}"} and {"{server}"}.</small></label>
        <label className="field" style={{ marginTop: 10 }}>Give a role<select className="input" value={doneRole} disabled={!isAdmin} onChange={(e) => setDoneRole(e.target.value)}><option value="">No role</option>{roles.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select><small>For example a “Creator” role that opens your creator channels. The bot needs Manage Roles and must sit above this role.</small></label>
        <div className="trow" style={{ marginTop: 10 }}><div><b>Tell the mods</b><span>Post their answers in your approvals channel when someone finishes</span></div><Sw checked={notifyDone} disabled={!isAdmin} label="Tell the mods" onChange={setNotifyDone} /></div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}><button className="btn sm primary" type="button" disabled={!isAdmin || !dirty} onClick={save}>Save changes</button></div>
        <div className="trow" style={{ marginTop: 16 }}><div><b>Find phone numbers in replies</b><span>Saves any number a creator shares in DMs to their profile as their WhatsApp</span></div><Sw checked={cfg.waDetect !== false} disabled={!isAdmin} label="Find phone numbers" onChange={(v) => pref("waDetect", v)} /></div>
        <div className="trow"><div><b>Remind after 24 hours of silence</b><span>One friendly nudge, also to members who stop halfway (it repeats the question they’re on), then we stop</span></div><Sw checked={cfg.reminders !== false} disabled={!isAdmin} label="Reminders" onChange={(v) => pref("reminders", v)} /></div>
      </section>
      <section className="tile s5">
        <div className="th"><h2>Preview</h2><span className="muted" style={{ fontSize: "var(--text-micro)" }}>How the DM reads</span></div>
        <div className="dc"><div className="chan"><Ico name="chat" />Direct message</div><div className="msg"><div className="av"><BotAvatar /></div><div style={{ minWidth: 0, display: "grid", gap: 8 }}>
          <div className="who">{botName} <small>APP</small></div>
          <div>{welcome.replace(/\{(first_name|name)\}/g, "Lena").replace(/\{(server|brand)\}/g, guild?.guildName || "your server")}</div>
          {qs.filter(Boolean).map((q, i) => <div key={i}><b style={{ color: "var(--color-discord-head)" }}>{i + 1}.</b> {q}</div>)}
          {done.trim() && <div style={{ color: "var(--color-discord-muted)" }}>After the last answer: {done.replace(/\{(first_name|name)\}/g, "Lena").replace(/\{(server|brand)\}/g, guild?.guildName || "your server")}</div>}
        </div></div></div>
      </section>
    </div>
  );
}

/** Download the onboarding answers as a CSV file. */
function exportCsv(dms, questions, server) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["Name", "Discord", "TikTok", "WhatsApp", "Status", "Started", ...questions];
  const status = (t) => (t.status === "done" || t.status === "needs" ? "Done" : t.status === "closed" ? "Not delivered" : answered(t) ? "In progress" : "No reply");
  const lines = dms.map((t) => [t.name, t.user, t.tiktok ? "@" + t.tiktok : "", t.wa || "", status(t), (t.startedAt || "").slice(0, 10), ...questions.map((q) => t.answers?.[q] || "")].map(esc).join(","));
  const blob = new Blob(["\ufeff" + [head.map(esc).join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `onboarding-${(server || "responses").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function Responses() {
  const { dms, ob, setView, requestWait, toast, canEdit, isAdmin, guild } = useApp();
  const { members } = useCommunity();
  const [busy, setBusy] = useState("");
  const fresh = members.filter((m) => !m.thread);
  const welcome = async (m) => {
    setBusy(m.id);
    const r = await requestWait("welcome", { userId: m.id });
    setBusy("");
    toast(r.ok ? `Welcome DM sent to ${m.name}` : r.error || "Couldn’t send the DM.");
  };
  const welcomeAll = async () => {
    setBusy("all");
    toast(`Sending the welcome DM to ${Math.min(fresh.length, 100)} members. This takes about a second each.`);
    const r = await requestWait("welcome_all", {});
    setBusy("");
    if (!r.ok) return toast(r.error || "Couldn’t send the welcome DMs.");
    toast(`Welcome DM sent to ${r.result.sent} member${r.result.sent === 1 ? "" : "s"}${r.result.failed ? `, ${r.result.failed} have DMs closed` : ""}${r.result.left ? `. ${r.result.left} left, run it again` : ""}.`);
  };
  const cut = (q) => (q.length > 28 ? q.slice(0, 28) + "…" : q);
  const finished = dms.filter((t) => t.status === "done" || t.status === "needs").length;
  return (
    <>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <span className="muted" style={{ fontSize: "var(--text-small)" }}>{dms.length} conversation{dms.length === 1 ? "" : "s"} · {finished} finished · {dms.filter((t) => t.tiktok).length} linked to TikTok</span>
        <button className="btn sm" type="button" style={{ marginLeft: "auto" }} disabled={!dms.length} onClick={() => exportCsv(dms, ob.questions, guild?.guildName)}><Ico name="download" />Export CSV</button>
      </div>
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
          <div className="h"><h3>Not welcomed yet</h3><p>{fresh.length} member{fresh.length === 1 ? "" : "s"} joined before the bot was listening. Send them the welcome DM now.</p><div className="r"><button className="btn sm primary" type="button" disabled={!isAdmin || !!busy} onClick={welcomeAll}>{busy === "all" ? "Sending…" : `Welcome all ${fresh.length > 100 ? "(100 at a time)" : fresh.length}`}</button></div></div>
          {fresh.slice(0, 50).map((m) => (
            <div key={m.id} className="trow"><div style={{ display: "flex", gap: 10, alignItems: "center" }}><span className="cav">{initials(m.name)}</span><div><b>{m.name}</b><span>@{m.user} · joined {m.joined}</span></div></div><button className="btn sm" type="button" disabled={!canEdit || !!busy} onClick={() => welcome(m)}>{busy === m.id ? "Sending…" : "Send welcome DM"}</button></div>
          ))}
        </section>
      )}
    </>
  );
}
