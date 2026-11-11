import { useState } from "react";
import { useApp } from "../context/app.js";
import { db } from "../services/db.js";
import { ACCESS_HELP, STATUS, autoByKey } from "../lib/constants.js";
import { draftMsgs } from "../lib/discordMarkdown.js";
import { fmtTime } from "../lib/format.js";
import { DiscordPreview, Empty, Hero } from "../components/ui.jsx";
import { useTestDraft } from "../hooks/useTestDraft.js";

export default function Approvals() {
  const { guild, drafts, building } = useApp();
  const pend = drafts.filter((d) => d.status === "pending" || d.status === "posting");
  const done = drafts.filter((d) => !["pending", "posting"].includes(d.status));

  return (
    <>
      <Hero eyebrow={guild ? guild.guildName : "Discord"} title="Approvals" lede="Every draft shows exactly as it will post. Approve, edit, regenerate or reject." />
      <div className="grid">
        <section className="card">
          <div className="head"><h2>Waiting on you</h2><span className="pill">{pend.length}</span></div>
          {building.map((r) => (
            <div key={r.id} className="drafting">
              <span className="ndisc">…</span>
              <span><b>{autoByKey(r.automation)?.name || "Draft"}</b><span className="muted" style={{ display: "block" }}>Building… · {fmtTime(r.at)}</span></span>
            </div>
          ))}
          {pend.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>{pend.map((d) => <DraftCard key={d.id} d={d} />)}</div>
          ) : !building.length && <Empty title="All caught up">Use Test Post in Automations to see a draft here.</Empty>}
        </section>

        <section className="card">
          <div className="head"><h2>Activity log</h2><span className="muted">{done.length} decided</span></div>
          {done.length ? (
            <div className="rows">
              {done.slice(0, 40).map((d) => {
                const st = STATUS[d.status] || [d.status, ""];
                return (
                  <div key={d.id}>
                    <span className="grow">
                      <b className="trunc">{d.name}{d.channelName ? " → #" + d.channelName : ""}</b>
                      <span className="muted">{fmtTime(d.decidedAt || d.createdAt)} · {(d.history || []).slice(-1)[0]?.what || ""}</span>
                      {d.messageUrl && <a className="posted" href={d.messageUrl} target="_blank" rel="noopener noreferrer">Open in Discord ↗</a>}
                    </span>
                    <span className={"pill " + st[1]}>{st[0]}</span>
                    <button className="btn sm ghost" aria-label="Delete" title="Delete" onClick={() => db.remove("drafts/" + d.id)}>✕</button>
                  </div>
                );
              })}
            </div>
          ) : <Empty>Posted, rejected and expired drafts show here.</Empty>}
        </section>
      </div>
    </>
  );
}

function DraftCard({ d }) {
  const { cfg, canPost, chName, request, toast } = useApp();
  const [, testDraft] = useTestDraft();
  const [editing, setEditing] = useState(false);
  const msgs = draftMsgs(d);
  const [texts, setTexts] = useState(() => msgs.map((m) => m.text));
  const posting = d.status === "posting";
  const error = !posting && d.channel && !canPost(d.channel) ? `The bot can’t see #${d.channelName || chName(d.channel)}. ${ACCESS_HELP}` : d.error;
  const now = () => new Date().toISOString();
  const path = "drafts/" + d.id;
  const hist = (what) => [...(d.history || []), { at: now(), what }];

  const saveEdit = async () => {
    const next = msgs.map((m, i) => ({ ...m, text: (texts[i] ?? m.text).slice(0, 2000) }));
    await db.update(path, { messages: next, text: next.map((m) => m.text).join("\n\n").slice(0, 4000), history: hist("Edited") });
    setEditing(false);
    toast("Edit saved");
  };
  const regen = async () => {
    await db.update(path, { status: "replaced", decidedAt: now(), history: hist("Regenerated") });
    testDraft(d.automation, d.id);
  };
  const reject = async () => {
    await db.update(path, { status: "rejected", decidedAt: now(), history: hist("Rejected in Creator OS") });
    if (d.source === "schedule") request("reject", { draftId: d.id });
    toast("Rejected");
  };
  const post = async () => {
    await db.update(path, { status: "posting", error: null, decidedAt: now(), history: hist("Approved, sending to Discord") });
    const sent = await request("post", { draftId: d.id, channel: d.channel });
    if (!sent) await db.update(path, { status: "pending", error: "Couldn’t reach Claude to post. Try again, or ask Claude to post queued drafts." });
  };

  const preview = editing ? texts.map((t, i) => ({ ...msgs[i], text: t })) : msgs;

  return (
    <article className="draft">
      <div className="draft-head">
        <b>{d.name}{d.channelName ? " → #" + d.channelName : ""}</b>
        <span className="muted">{d.test ? "Test · " : ""}{fmtTime(d.createdAt)}</span>
      </div>
      <DiscordPreview botName={cfg.botName} messages={preview} />
      {d.test ? <span className="muted">Test · posts to #{d.channelName || "moderator-only"}</span> : d.source === "schedule" ? <span className="muted">Also in #moderator-only</span> : null}

      {editing && msgs.map((m, i) => (
        <div key={i} className="field">
          <label htmlFor={`ed-${d.id}-${i}`} className="muted">Message {i + 1} of {msgs.length}</label>
          <textarea id={`ed-${d.id}-${i}`} rows={6} maxLength={2000} value={texts[i]} onChange={(e) => setTexts(texts.map((t, j) => (j === i ? e.target.value : t)))} />
        </div>
      ))}

      {posting ? <span className="pill">Posting… Claude is sending it to Discord</span> : (
        <div className="row-actions" style={{ gap: 6 }}>
          <button className="btn sm primary" disabled={!d.channel || editing} onClick={post}>Approve &amp; Post</button>
          {editing ? <>
            <button className="btn sm" onClick={saveEdit}>Save Edit</button>
            <button className="btn sm ghost" onClick={() => { setTexts(msgs.map((m) => m.text)); setEditing(false); }}>Cancel</button>
          </> : <button className="btn sm" onClick={() => setEditing(true)}>Edit</button>}
          {d.source !== "schedule" && !editing && <button className="btn sm" onClick={regen}>Regenerate</button>}
          {!editing && <button className="btn sm ghost" onClick={reject}>Reject</button>}
        </div>
      )}
      {error && <span className="pill bad">{error}</span>}
    </article>
  );
}
