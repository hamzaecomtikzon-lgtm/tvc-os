import { useState } from "react";
import { useApp } from "../context/app.js";
import { db } from "../services/db.js";
import { draftMsgs } from "../lib/discordMarkdown.js";
import { fmtTime } from "../lib/format.js";
import { Dc, Empty, Ico, PageHead, Tabs } from "../components/ui.jsx";

const TABS = [["pending", "Waiting on you"], ["posted", "Posted"], ["rejected", "Rejected"]];

export default function Approvals() {
  const { drafts, building, cfg, chName, view, setView } = useApp();
  const tab = view.ap || "pending";
  const n = (s) => drafts.filter((d) => (s === "pending" ? d.status === "pending" || d.status === "posting" : d.status === s)).length;
  const list = drafts.filter((d) => (tab === "pending" ? d.status === "pending" || d.status === "posting" : d.status === tab));
  const mod = cfg.modChannel ? "#" + chName(cfg.modChannel) : "";
  return (
    <>
      <PageHead title="Approvals" desc={mod ? `Every draft also waits in ${mod}, where a moderator can react ✅ or ❌. Whoever approves first posts it, once.` : "Pick an approvals channel in Settings → Channels to also review drafts in Discord."} />
      <Tabs value={tab} onChange={(ap) => setView({ ap })} tabs={TABS.map(([k, l]) => [k, l, <span key="n" className={"pill " + (k === "pending" && n(k) ? "rose" : "line")}>{n(k)}</span>])} />
      {tab === "pending" && building.length > 0 && <div className="hint" style={{ marginBottom: 14 }}><span className="spin" aria-hidden="true" /><div>Building {building.length} draft{building.length === 1 ? "" : "s"}…</div></div>}
      {list.length ? list.map((d) => <Draft key={d.id} d={d} />) : (
        <div className="tile"><Empty title={tab === "pending" ? "Nothing waiting" : "Nothing here yet"}>{tab === "pending" ? "New drafts show up here and in your approvals channel. Use Run now on an automation to build one." : ""}</Empty></div>
      )}
    </>
  );
}

// A role-changes draft may have no announcement at all; every other draft has at least one message.
const msgsOf = (d) => (d.action ? d.messages || [] : draftMsgs(d));

function Draft({ d }) {
  const { requestWait, toast, canEdit } = useApp();
  const [msgs, setMsgs] = useState(() => msgsOf(d));
  const [busy, setBusy] = useState("");
  const pending = d.status === "pending";
  const dirty = JSON.stringify(msgs.map((m) => m.text)) !== JSON.stringify(msgsOf(d).map((m) => m.text));

  const save = async () => {
    if (!dirty) return true;
    const { id, ...doc } = d;
    try {
      await db.set("drafts/" + id, { ...doc, messages: msgs, text: msgs.map((m) => m.text).join("\n\n") });
      return true;
    } catch (e) {
      toast("Couldn’t save your edit. " + e.message);
      return false;
    }
  };
  const run = async (type, okText) => {
    setBusy(type);
    const r = (await save()) && (await requestWait(type, { draftId: d.id }));
    setBusy("");
    if (!r) return;
    if (!r.ok) return toast(r.error || "That didn’t work. Try again.");
    if (type === "post" && r.result.posted === false) return toast(r.result.error || "Couldn’t post it.");
    toast(okText);
  };
  const tiersAct = d.action?.type === "tiers";
  const nudgeAct = d.action?.type === "nudges";
  const where = d.channel === "dm" ? "a DM to each creator" : d.channelName ? "#" + d.channelName : "no channel";
  const tierName = (id) => { const t = d.action?.tiers?.find((x) => x.id === id); return t ? (t.emoji ? t.emoji + " " : "") + t.name : "no tier"; };

  return (
    <article className="appr">
      <div style={{ minWidth: 0 }}>
        <span className="pill">{d.name}</span>
        <h3>{d.name} · {fmtTime(d.createdAt)}</h3>
        <p className="muted" style={{ fontSize: "var(--text-small)" }}>{nudgeAct ? <>A DM to <b style={{ color: "var(--color-heading)", fontWeight: 500 }}>{d.action.nudges.length} creator{d.action.nudges.length === 1 ? "" : "s"}</b> about their sample</> : tiersAct ? <>{d.action.changes.length} role change{d.action.changes.length === 1 ? "" : "s"} · {d.channel ? <>announced in <b style={{ color: "var(--color-heading)", fontWeight: 500 }}>{where}</b></> : "not announced"}</> : <>Posts to <b style={{ color: "var(--color-heading)", fontWeight: 500 }}>{where}</b></>} · {d.source === "schedule" ? "built on schedule" : "built by hand"}</p>
        {d.error && <p className="err" style={{ marginTop: 8, whiteSpace: "pre-line" }}>{d.error}</p>}
        {nudgeAct && (
          <div style={{ marginTop: 14 }}>
            <div className="sec-t">Who gets a DM</div>
            {d.action.nudges.slice(0, 30).map((c) => (
              <div key={c.applyId} className="lrow"><span className="cav">{(c.name || "?").slice(0, 1).toUpperCase()}</span><div><b>{c.name}</b><span className="sub">@{c.handle} · {c.product}</span></div><span className="num" style={{ fontFamily: "var(--font-sans)" }}>{c.n === 2 ? "2nd reminder" : "1st"} · day {c.days}</span></div>
            ))}
            {d.action.nudges.length > 30 && <p className="muted" style={{ fontSize: "var(--text-micro)" }}>and {d.action.nudges.length - 30} more</p>}
          </div>
        )}
        {tiersAct && (
          <div style={{ marginTop: 14 }}>
            <div className="sec-t">Role changes</div>
            {d.action.changes.slice(0, 30).map((c) => (
              <div key={c.userId} className="lrow"><span className="cav">{(c.name || "?").slice(0, 1).toUpperCase()}</span><div><b>{c.name}</b><span className="sub">@{c.handle}</span></div><span className="num" style={{ fontFamily: "var(--font-sans)" }}>{tierName(c.current)} → {tierName(c.target)}</span></div>
            ))}
            {d.action.changes.length > 30 && <p className="muted" style={{ fontSize: "var(--text-micro)" }}>and {d.action.changes.length - 30} more</p>}
          </div>
        )}
        {pending ? (
          <>
            {msgs.map((m, i) => (
              <label key={i} className="field" style={{ marginTop: 14 }}>{nudgeAct ? (d.action.templates[i] === "second" ? "Second reminder" : "First nudge") : msgs.length > 1 ? `Message ${i + 1} of ${msgs.length}` : "Message"}
                <textarea className="input" value={m.text} disabled={!canEdit} onChange={(e) => setMsgs(msgs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} onBlur={save} />
              </label>
            ))}
            {(d.postAt || d.changes) && (
              <div className="meta">
                {d.postAt && <span className="pill good">Approved by {d.approvedBy || "a moderator"} · posts {fmtTime(d.postAt)}</span>}
                {d.changes && <span className="pill line" title={d.changes}>Changes asked: {d.changes.length > 90 ? d.changes.slice(0, 90) + "…" : d.changes}</span>}
              </div>
            )}
            <div className="acts">
              {nudgeAct
                ? <button className="btn primary" type="button" disabled={!canEdit || !!busy} onClick={() => run("post", "Follow-ups sent")}><Ico name="check" />{busy === "post" ? "Sending…" : "Approve & send DMs"}</button>
                : tiersAct
                ? <button className="btn primary" type="button" disabled={!canEdit || !!busy} onClick={() => run("post", "Roles updated")}><Ico name="check" />{busy === "post" ? "Applying…" : d.channel ? "Approve, apply & announce" : "Approve & apply roles"}</button>
                : <button className="btn primary" type="button" disabled={!canEdit || !!busy || !d.channel} onClick={() => run("post", `Posted to ${where}`)}><Ico name="check" />{busy === "post" ? "Posting…" : "Approve & post"}</button>}
              {(!tiersAct || msgs.length > 0) && <button className="btn" type="button" disabled={!canEdit || !!busy} onClick={() => run("test", "Test sent to your approvals channel")}>{busy === "test" ? "Sending…" : "Send test to mods"}</button>}
              <button className="btn ghost" type="button" disabled={!canEdit || !!busy} onClick={() => run("reject", "Rejected")}>Reject</button>
            </div>
          </>
        ) : (
          <div className="meta">
            {d.status === "posting" ? <span className="pill">Posting…</span> : <span className={"pill " + (d.status === "posted" ? "good" : "line")}>{d.status === "posted" ? "Posted" : "Rejected"} by {d.by || "You"}</span>}
            {d.status === "posted" && d.channel !== "dm" && !tiersAct && <span className="pill line">🔥 🤍 🚀 📈 added</span>}
            {d.status === "posted" && d.action && d.history?.length > 0 && <span className="pill line">{d.history[d.history.length - 1].what}</span>}
            {d.messageUrl && <a className="pill line" href={d.messageUrl} target="_blank" rel="noopener noreferrer">Open in Discord <Ico name="external" /></a>}
          </div>
        )}
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="sec-t">Preview</div>
        {tiersAct && !msgs.length
          ? <div className="hint"><Ico name="users" /><div>Roles only: nothing is posted in a channel.{d.action.dm ? " Creators who move up get a congratulations DM." : ""}</div></div>
          : <Dc channel={d.channelName} dm={d.channel === "dm"} messages={msgs} time={d.status === "posted" ? fmtTime(d.postedAt) : "Waiting"} />}
        {nudgeAct && <p className="muted" style={{ fontSize: "var(--text-micro)", marginTop: 6 }}>{"{first_name}"}, {"{product}"}, {"{days}"} and {"{due_date}"} are filled in for each creator.</p>}
        {msgs.some((m) => m.images?.some((u) => u.startsWith("data:"))) && <p className="muted" style={{ fontSize: "var(--text-micro)", marginTop: 6 }}>The card is a preview. Discord gets the text; the image isn’t uploaded yet.</p>}
      </div>
    </article>
  );
}
