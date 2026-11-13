import { useState } from "react";
import { useApp } from "../context/app.js";
import { db } from "../services/db.js";
import { AUTOS, BUILDABLE, MENTIONS, WEEKDAYS, daysTimeText, scheduleText } from "../lib/constants.js";
import { ChanSelect, Drawer, Ico, PageHead, Sw } from "../components/ui.jsx";

export function DayChips({ value, onChange }) {
  return (
    <div className="daychips">
      {WEEKDAYS.map((d) => <button key={d} type="button" className={"chip" + (value.includes(d) ? " on" : "")} aria-pressed={value.includes(d)} onClick={() => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d])}>{d}</button>)}
    </div>
  );
}

export default function Automations() {
  const { autos, customs, chName, saveAutos, saveCustom, request, go, toast, conn, canEdit, isAdmin, setView } = useApp();
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState("");

  const toggle = async (a, val) => {
    if (await saveAutos({ ...autos, [a.key]: { ...autos[a.key], enabled: val } })) toast(`${a.name} ${val ? "turned on" : "paused"}`);
  };
  const run = async (payload, name) => {
    setBusy(name);
    const ok = await request("draft", { ...payload, source: "manual" });
    setBusy("");
    toast(ok ? `${name}: draft is being built. Review it in Approvals.` : "Couldn’t start the draft. The server isn’t answering.");
    if (ok) setView({ ap: "pending" });
  };
  const remove = async (c) => {
    try {
      await db.remove("custom/" + c.id);
      toast("Custom automation deleted");
    } catch (e) {
      toast("Couldn’t delete it. " + e.message);
    }
  };
  const mentionText = (m) => MENTIONS.find((x) => x[0] === m)?.[1];

  return (
    <>
      <PageHead title="Automations" desc="Turn automations on or off, change where they post, or build your own.">
        <button className="btn primary" type="button" disabled={!isAdmin} onClick={() => go("automation-builder", { cb: null })}><Ico name="spark" />New custom automation</button>
      </PageHead>
      <div className="autos">
        {AUTOS.map((a) => {
          const s = autos[a.key];
          const needsAi = a.key === "general_chat" && s.enabled && !conn.ai;
          return (
            <article key={a.key} className={"auto" + (s.enabled ? "" : " off")}>
              <div className="t">
                <span className="disc">{a.n}</span>
                <div><h3>{a.name}</h3><span className={"pill " + (s.enabled ? (needsAi ? "rose" : "good") : "line")} style={{ marginTop: 4 }}>{s.enabled ? (needsAi ? "Needs an AI key" : "On") : "Paused"}</span></div>
                <Sw checked={s.enabled} disabled={!isAdmin} label={`Turn ${a.name} on or off`} onChange={(v) => toggle(a, v)} />
              </div>
              <p>{a.what}</p>
              <div className="m">
                {a.key === "onboarding" ? <span className="pill line"><Ico name="chat" />Direct message</span> : <span className="pill line"><Ico name="hash" />{s.channel ? chName(s.channel) : "No channel"}</span>}
                <span className="pill line">{scheduleText(a, s)}</span>
                {s.mention && <span className="pill line">{mentionText(s.mention)}</span>}
                {BUILDABLE.includes(a.key) && <span className="pill line">{s.mode === "auto" ? "Posts automatically" : "Needs approval"}</span>}
              </div>
              <div className="b">
                <button className="btn sm" type="button" disabled={!isAdmin} onClick={() => setEditing(a.key)}><Ico name="edit" />Edit</button>
                {BUILDABLE.includes(a.key) && <button className="btn sm ghost" type="button" disabled={!canEdit || !!busy || !s.channel} title={s.channel ? "" : "Pick a channel first"} onClick={() => run({ automation: a.key }, a.name)}>{busy === a.name ? "Building…" : "Run now"}</button>}
              </div>
            </article>
          );
        })}
        {customs.map((c) => (
          <article key={c.id} className={"auto" + (c.on ? "" : " off")}>
            <div className="t">
              <span className="disc"><Ico name="spark" /></span>
              <div><h3>{c.name}</h3><span className="pill rose" style={{ marginTop: 4 }}>Custom{c.on ? "" : " · paused"}</span></div>
              <Sw checked={c.on} disabled={!isAdmin} label={`Turn ${c.name} on or off`} onChange={(v) => { const { id, ...doc } = c; saveCustom(id, { ...doc, on: v }); toast(`${c.name} ${v ? "turned on" : "paused"}`); }} />
            </div>
            <p>{c.what}</p>
            <div className="m">
              <span className="pill line">{c.channel === "dm" ? "Direct message" : c.channel ? "#" + chName(c.channel) : "No channel"}</span>
              <span className="pill line">{daysTimeText(c.days, c.time)}</span>
              {c.approval !== false && <span className="pill line">Needs approval</span>}
            </div>
            <div className="b">
              <button className="btn sm" type="button" disabled={!isAdmin} onClick={() => go("automation-builder", { cb: c.id })}><Ico name="edit" />Open in builder</button>
              <button className="btn sm ghost" type="button" disabled={!canEdit || !!busy || !c.channel} onClick={() => run({ custom: c.id }, c.name)}>{busy === c.name ? "Building…" : "Run now"}</button>
              <button className="btn sm ghost" type="button" disabled={!isAdmin} onClick={() => remove(c)}>Delete</button>
            </div>
          </article>
        ))}
        <button className="auto new" type="button" disabled={!isAdmin} onClick={() => go("automation-builder", { cb: null })}>
          <span className="disc" style={{ background: "var(--color-primary-tint)", color: "var(--color-primary)" }}><Ico name="plus" /></span>
          <h3 style={{ fontFamily: "var(--font-sans)", fontSize: "var(--text-body-sm)", fontWeight: 600, color: "var(--color-heading)" }}>Build a custom automation</h3>
          <p>Describe what you want in plain words. Kreo drafts it, shows you a live preview, and you deploy it to any channel.</p>
        </button>
      </div>
      {editing && <Editor a={AUTOS.find((x) => x.key === editing)} close={() => setEditing(null)} />}
    </>
  );
}

function Editor({ a, close }) {
  const { autos, cfg, chName, saveAutos, toast, conn } = useApp();
  const [s, setS] = useState(autos[a.key]);
  const set = (patch) => setS((x) => ({ ...x, ...patch }));
  const scheduled = BUILDABLE.includes(a.key);
  const mod = cfg.modChannel ? "#" + chName(cfg.modChannel) : "your approvals channel";
  const save = async () => {
    if (scheduled && s.enabled && (!s.days?.length || !s.time)) return toast("Pick at least one day and a time.");
    if (await saveAutos({ ...autos, [a.key]: s })) {
      toast(a.name + " saved");
      close();
    }
  };
  return (
    <Drawer title={a.name} onClose={close} footer={<><button className="btn" type="button" onClick={close}>Cancel</button><button className="btn primary" type="button" onClick={save}>Save</button></>}>
      <p className="muted" style={{ fontSize: "var(--text-small)" }}>{a.what}</p>
      {a.key === "onboarding" ? (
        <div className="hint"><Ico name="chat" /><div>Runs by direct message when someone joins. Edit the welcome message and questions in Onboarding &amp; DMs → Questions.{conn.gateway.members === false && <><br /><b>Needs the Server Members Intent</b> switched on for your bot in the Discord Developer Portal (Bot → Privileged Gateway Intents), then a backend restart.</>}</div></div>
      ) : (
        <label className="field">{a.key === "general_chat" ? "Answers in" : "Posts to"}<ChanSelect value={s.channel} onChange={(channel) => set({ channel })} none="No channel (paused)" /></label>
      )}
      {scheduled && (
        <>
          <div className="field">Days<DayChips value={s.days || []} onChange={(days) => set({ days })} /></div>
          <label className="field">Time<input className="input" type="time" value={s.time || ""} onChange={(e) => set({ time: e.target.value })} /><small>In your workspace time zone ({cfg.timezone}).</small></label>
          {"mention" in a.defaults && <label className="field">Notify<select className="input" value={s.mention} onChange={(e) => set({ mention: e.target.value })}>{MENTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>}
          <div className="trow" style={{ border: 0, padding: 0 }}><div><b>Needs approval</b><span>Drafts go to {mod} and Approvals first</span></div><Sw checked={s.mode !== "auto"} label="Needs approval" onChange={(v) => set({ mode: v ? "manual" : "auto" })} /></div>
        </>
      )}
      {a.key === "viral_hooks" && <label className="field">Look back (days)<input className="input" type="number" min="1" max="30" value={s.lookback} onChange={(e) => set({ lookback: Math.max(1, parseInt(e.target.value, 10) || 7) })} /></label>}
      {a.key === "leaderboard" && <label className="field">How many creators<input className="input" type="number" min="3" max="10" value={s.topN} onChange={(e) => set({ topN: Math.max(3, Math.min(10, parseInt(e.target.value, 10) || 5)) })} /></label>}
      {a.key === "wins" && <label className="field">Milestones (sales)<input className="input" value={s.thresholds} onChange={(e) => set({ thresholds: e.target.value })} /><small>Comma-separated, like 1, 3, 10, 30, 50.</small></label>}
      {a.key === "general_chat" && (
        <>
          {!conn.ai && <div className="hint warn"><Ico name="spark" /><div>Replies are written by an AI model, which needs a key. Add <b>ANTHROPIC_API_KEY</b> to backend/.env and restart the backend. Until then the bot stays silent in this channel.</div></div>}
          {conn.ai && conn.gateway.content === false && <div className="hint warn"><Ico name="shield" /><div>Discord only shows the bot messages that @mention it. To let it read every message, turn on <b>Message Content Intent</b> for your bot in the Discord Developer Portal, then restart the backend.</div></div>}
          <label className="field">Reply to<select className="input" value={s.replyTo} onChange={(e) => set({ replyTo: e.target.value })}><option value="questions">Questions and @mentions</option><option value="mentions">Only when @mentioned</option><option value="all">Every message</option></select></label>
          <label className="field">Topics that go to mods instead<textarea className="input" value={s.escalate} onChange={(e) => set({ escalate: e.target.value })} /><small>The bot flags these in {mod} and doesn’t answer them.</small></label>
          <label className="field">Most replies per day<input className="input" type="number" min="1" value={s.dailyCap} onChange={(e) => set({ dailyCap: Math.max(1, parseInt(e.target.value, 10) || 300) })} /></label>
          <label className="field">Voice notes for the bot<textarea className="input" placeholder="Hype but not cringe. Short sentences. Max 2 emojis." value={s.voice || ""} onChange={(e) => set({ voice: e.target.value })} /></label>
        </>
      )}
    </Drawer>
  );
}
