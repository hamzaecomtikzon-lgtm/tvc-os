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

function Draft({ d }) {
  const { requestWait, toast, canEdit } = useApp();
  const [msgs, setMsgs] = useState(() => draftMsgs(d));
  const [busy, setBusy] = useState("");
  const pending = d.status === "pending";
  const dirty = JSON.stringify(msgs.map((m) => m.text)) !== JSON.stringify(draftMsgs(d).map((m) => m.text));

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
  const where = d.channel === "dm" ? "a DM to each creator" : d.channelName ? "#" + d.channelName : "no channel";

  return (
    <article className="appr">
      <div style={{ minWidth: 0 }}>
        <span className="pill">{d.name}</span>
        <h3>{d.name} · {fmtTime(d.createdAt)}</h3>
        <p className="muted" style={{ fontSize: "var(--text-small)" }}>Posts to <b style={{ color: "var(--color-heading)", fontWeight: 500 }}>{where}</b> · {d.source === "schedule" ? "built on schedule" : "built by hand"}</p>
        {d.error && <p className="err" style={{ marginTop: 8 }}>{d.error}</p>}
        {pending ? (
          <>
            {msgs.map((m, i) => (
              <label key={i} className="field" style={{ marginTop: 14 }}>{msgs.length > 1 ? `Message ${i + 1} of ${msgs.length}` : "Message"}
                <textarea className="input" value={m.text} disabled={!canEdit} onChange={(e) => setMsgs(msgs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} onBlur={save} />
              </label>
            ))}
            <div className="acts">
              <button className="btn primary" type="button" disabled={!canEdit || !!busy || !d.channel} onClick={() => run("post", `Posted to ${where}`)}><Ico name="check" />{busy === "post" ? "Posting…" : "Approve & post"}</button>
              <button className="btn" type="button" disabled={!canEdit || !!busy} onClick={() => run("test", "Test sent to your approvals channel")}>{busy === "test" ? "Sending…" : "Send test to mods"}</button>
              <button className="btn ghost" type="button" disabled={!canEdit || !!busy} onClick={() => run("reject", "Rejected")}>Reject</button>
            </div>
          </>
        ) : (
          <div className="meta">
            {d.status === "posting" ? <span className="pill">Posting…</span> : <span className={"pill " + (d.status === "posted" ? "good" : "line")}>{d.status === "posted" ? "Posted" : "Rejected"} by {d.by || "You"}</span>}
            {d.status === "posted" && d.channel !== "dm" && <span className="pill line">🔥 🤍 🚀 📈 added</span>}
            {d.messageUrl && <a className="pill line" href={d.messageUrl} target="_blank" rel="noopener noreferrer">Open in Discord <Ico name="external" /></a>}
          </div>
        )}
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="sec-t">Preview</div>
        <Dc channel={d.channelName} dm={d.channel === "dm"} messages={msgs} time={d.status === "posted" ? fmtTime(d.postedAt) : "Waiting"} />
        {msgs.some((m) => m.images?.length) && <p className="muted" style={{ fontSize: "var(--text-micro)", marginTop: 6 }}>The card is a preview. Discord gets the text; the image isn’t uploaded yet.</p>}
      </div>
    </article>
  );
}
