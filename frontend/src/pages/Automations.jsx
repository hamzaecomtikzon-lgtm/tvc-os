import { useState } from "react";
import { useApp } from "../context/app.js";
import { ACCESS_HELP, AUTOS, BUILDABLE, MODE_LABEL, WIN_PARTS, scheduleText } from "../lib/constants.js";
import { draftMsgs } from "../lib/discordMarkdown.js";
import { ChanSelect, DayChecks, DiscordPreview, Hero, Switch } from "../components/ui.jsx";
import Modal from "../components/Modal.jsx";

export default function Automations() {
  const { guild, autos, allow, saveAutos, toast, canPost, chName } = useApp();
  const [settingsFor, setSettingsFor] = useState(null);
  const [testFor, setTestFor] = useState(null);

  const allowed = (id) => !!(allow && allow.syncedAt && (allow.channels || []).some((c) => c.id === id));
  const blocked = [...new Set(AUTOS.map((a) => autos[a.key].channel).filter((id) => id && !canPost(id)))];
  const allOn = AUTOS.every((a) => autos[a.key].enabled);

  const toggle = async (key) => {
    const on = !autos[key].enabled;
    if (await saveAutos({ ...autos, [key]: { ...autos[key], enabled: on } })) toast(on ? "Turned on" : "Turned off");
  };
  const setAll = async (on) => {
    const next = {};
    AUTOS.forEach((a) => (next[a.key] = { ...autos[a.key], enabled: on }));
    if (await saveAutos(next)) toast(on ? "All six automations are on" : "All automations are off");
  };

  return (
    <>
      <Hero
        eyebrow={guild ? guild.guildName : "Discord"}
        title="Automations"
        lede="Times in ET. Drafts need approval before posting."
        right={<button className="btn primary" onClick={() => setAll(!allOn)}>{allOn ? "Turn All Off" : "Turn All On"}</button>}
      />

      {blocked.length > 0 && (
        <div className="err">
          <b>The bot can’t see {blocked.map((id) => "#" + chName(id)).join(", ")}.</b> Posts to these channels will fail. {ACCESS_HELP}
        </div>
      )}

      <div className="autos-wrap">
        <div className="autos">
          {AUTOS.map((a) => {
            const s = autos[a.key];
            const cn = chName(s.channel);
            const status = !s.enabled ? "Off" : !s.channel ? "Needs a channel" : "Ready";
            return (
              <article key={a.key} className={"card auto" + (settingsFor === a.key ? " sel" : "")}>
                <div className="auto-top">
                  <div className="auto-id">
                    <span className="ndisc">{a.n}</span>
                    <div style={{ minWidth: 0 }}>
                      <h2>{a.name}</h2>
                      <span className="auto-chan trunc">{cn ? "#" + cn : "No channel chosen"}</span>
                    </div>
                  </div>
                  <Switch checked={s.enabled} onChange={() => toggle(a.key)} label={a.name} />
                </div>
                <p className="auto-what">{a.what}</p>
                <div className="checks">
                  <span className="pill">{scheduleText(a, s)}</span>
                  <span className="pill line">{MODE_LABEL[s.mode]}</span>
                  {s.channel && (!canPost(s.channel)
                    ? <span className="pill bad">Bot can’t see channel</span>
                    : allowed(s.channel) ? <span className="pill good">Allowlisted</span> : <span className="pill">Allowlist pending</span>)}
                </div>
                <div className="foot">
                  <span className="muted auto-status">{status}</span>
                  <span className="row-actions" style={{ gap: 6 }}>
                    <button className="btn sm" disabled={!s.channel || !BUILDABLE.includes(a.key)} onClick={() => setTestFor(a.key)}
                      title={!BUILDABLE.includes(a.key) ? "Test posts aren’t available for this automation" : !s.channel ? "Choose a channel first" : undefined}>
                      Test Post
                    </button>
                    <button className="btn sm" onClick={() => setSettingsFor(a.key)}>Settings</button>
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {settingsFor && <SettingsModal key={settingsFor} auto={AUTOS.find((a) => a.key === settingsFor)} onClose={() => setSettingsFor(null)} />}
      {testFor && <TestPostModal key={testFor} auto={AUTOS.find((a) => a.key === testFor)} onClose={() => setTestFor(null)} />}
    </>
  );
}

/* ---------- settings modal (one form, fields vary per automation) ---------- */
function SettingsModal({ auto: a, onClose }) {
  const { autos, saveAutos, toast } = useApp();
  const [n, setN] = useState(() => structuredClone(autos[a.key]));
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setN((p) => ({ ...p, [k]: v }));
  const num = (k) => (e) => set(k, e.target.value === "" ? "" : +e.target.value);
  const check = (k, label) => (
    <label className="chk"><input type="checkbox" checked={!!n[k]} onChange={(e) => set(k, e.target.checked)} />{label}</label>
  );
  const hasSchedule = ["viral_hooks", "winning_content", "leaderboard"].includes(a.key);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const clean = {
      ...n,
      reminderHours: +n.reminderHours || (a.key === "onboarding" ? 24 : 4),
      expireHours: +n.expireHours || 24,
      dailyCap: n.dailyCap === "" ? 0 : n.dailyCap,
      topN: +n.topN || 5,
    };
    if (await saveAutos({ ...autos, [a.key]: clean })) {
      toast("Saved · allowlist updated");
      onClose();
    }
    setSaving(false);
  };

  return (
    <Modal
      title={a.name}
      subtitle={a.what}
      onClose={onClose}
      size="lg"
      footer={<>
        <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        <button type="submit" form="auto-settings" className="btn primary" disabled={saving}>{saving ? "Saving…" : "Save Settings"}</button>
      </>}
    >
      <form id="auto-settings" className="form" onSubmit={submit}>
        <div className="field span">
          <span>Status</span>
          <label className="chk" style={{ alignSelf: "flex-start" }}>
            <input type="checkbox" checked={!!n.enabled} onChange={(e) => set("enabled", e.target.checked)} />
            {n.enabled ? "On" : "Off"}
          </label>
        </div>
        <label className="field">
          <span>{a.key === "onboarding" ? "Fallback channel" : "Post in"}</span>
          <ChanSelect value={n.channel} onChange={(v) => set("channel", v)} allowNone />
        </label>
        <label className="field">
          <span>Approval mode</span>
          <select value={n.mode} onChange={(e) => set("mode", e.target.value)}>
            {Object.entries(MODE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>

        {a.key === "general_chat" && <>
          <label className="field">
            <span>Reply to</span>
            <select value={n.replyTo} onChange={(e) => set("replyTo", e.target.value)}>
              <option value="all">Every message</option>
              <option value="questions">Questions only</option>
              <option value="mentions">Only when @mentioned</option>
            </select>
          </label>
          <label className="field"><span>Daily reply cap</span><input type="number" min="0" value={n.dailyCap} onChange={num("dailyCap")} /></label>
          <label className="field"><span>Quiet hours start</span><input type="time" value={n.quietStart} onChange={(e) => set("quietStart", e.target.value)} /></label>
          <label className="field"><span>Quiet hours end</span><input type="time" value={n.quietEnd} onChange={(e) => set("quietEnd", e.target.value)} /></label>
          <label className="field span"><span>Send these to mods instead of replying</span><input type="text" value={n.escalate} onChange={(e) => set("escalate", e.target.value)} /><small>Comma-separated topics</small></label>
        </>}

        {hasSchedule && <>
          <div className="field span"><span>Post on</span><DayChecks value={n.days || []} onChange={(v) => set("days", v)} /></div>
          <label className="field"><span>At (ET)</span><input type="time" value={n.time || "09:00"} onChange={(e) => set("time", e.target.value)} /></label>
        </>}

        {a.key === "viral_hooks" && <div className="field span"><span>Options</span><div className="checks">{check("everyone", "Notify with @here")}</div></div>}

        {a.key === "winning_content" && <>
          <div className="field span"><span>Options</span><div className="checks">{check("tagCreator", "Tag the creator")}{check("everyone", "Notify with @here")}</div></div>
          <div className="field span">
            <span>Include</span>
            <div className="checks">
              {WIN_PARTS.map((p) => (
                <label key={p} className="chk">
                  <input type="checkbox" checked={(n.parts || []).includes(p)}
                    onChange={() => set("parts", (n.parts || []).includes(p) ? n.parts.filter((x) => x !== p) : WIN_PARTS.filter((x) => x === p || (n.parts || []).includes(x)))} />
                  {p}
                </label>
              ))}
            </div>
          </div>
        </>}

        {a.key === "wins" && <>
          <label className="field"><span>Milestones (sales)</span><input type="text" value={n.thresholds} onChange={(e) => set("thresholds", e.target.value)} /><small>e.g. 1, 3, 10, 30, 50</small></label>
          <label className="field">
            <span>Check for new sales every</span>
            <select value={n.checkEvery} onChange={(e) => set("checkEvery", +e.target.value)}>
              <option value={1440}>Once a day</option><option value={240}>Every 4 hours</option><option value={60}>Every hour</option>
            </select>
          </label>
          <label className="field"><span>Daily check at (ET)</span><input type="time" value={n.time || "16:00"} onChange={(e) => set("time", e.target.value)} /></label>
          <div className="field span"><span>Options</span><div className="checks">{check("tagCreator", "Tag the creator")}{check("graphic", "Attach the milestone graphic")}{check("handleFallback", "Use TikTok @handle if not linked")}</div></div>
        </>}

        {a.key === "leaderboard" && <>
          <label className="field"><span>Show top</span><input type="number" min="3" max="10" value={n.topN} onChange={num("topN")} /></label>
          <div className="field span"><span>Options</span><div className="checks">{check("tagCreators", "Tag each creator")}{check("everyone", "Notify with @here")}</div></div>
        </>}

        {a.key === "onboarding" && <>
          <label className="field">
            <span>If DMs are closed</span>
            <select value={n.fallback} onChange={(e) => set("fallback", e.target.value)}>
              <option value="private-channel">Open a private welcome channel</option>
              <option value="channel">Ask in the fallback channel</option>
            </select>
          </label>
          <label className="field"><span>Reminder after (hours of silence)</span><input type="number" min="1" value={n.reminderHours} onChange={num("reminderHours")} /></label>
          <div className="field span"><span>Options</span><div className="checks">{check("linkFirst", "Ask for the TikTok handle first and link it")}</div></div>
          <p className="muted span" style={{ margin: 0 }}>Questions are edited in <a href="#onboarding" onClick={onClose}>Onboarding</a>.</p>
        </>}

        {a.key !== "onboarding" && <>
          <label className="field"><span>Reminder after (hours)</span><input type="number" min="1" value={n.reminderHours} onChange={num("reminderHours")} /><small>Nudge approvers if a draft is still waiting</small></label>
          <label className="field"><span>Expire after (hours)</span><input type="number" min="1" value={n.expireHours} onChange={num("expireHours")} /><small>Unapproved drafts are dropped</small></label>
        </>}
      </form>
    </Modal>
  );
}

/* ---------- test post: confirm → building → preview ---------- */
function TestPostModal({ auto: a, onClose }) {
  const { autos, cfg, chName, drafts, request, toast } = useApp();
  const s = autos[a.key];
  const [startedAt, setStartedAt] = useState(null);
  const draft = startedAt ? drafts.find((d) => d.automation === a.key && d.test && d.createdAt >= startedAt) : null;
  const modName = chName(cfg.modChannel) || "moderator-only";

  const build = async () => {
    setStartedAt(new Date().toISOString());
    const sent = await request("draft", { automation: a.key, test: true });
    if (!sent) toast("Saved. Ask Claude to process queued requests.");
  };
  const review = () => {
    onClose();
    location.hash = "#approvals";
  };

  const phase = !startedAt ? "confirm" : draft ? "ready" : "building";

  return (
    <Modal
      title={phase === "ready" ? "Test post ready" : "Send a test post"}
      subtitle={a.name}
      onClose={onClose}
      size={phase === "ready" ? "lg" : "md"}
      footer={phase === "confirm" ? <>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={build}>Build Test Post</button>
      </> : phase === "building" ? <>
        <button className="btn" onClick={() => { toast("Still building. It appears in Approvals when ready."); onClose(); }}>Close</button>
      </> : <>
        <button className="btn ghost" onClick={onClose}>Close</button>
        <button className="btn primary" onClick={review}>Review in Approvals</button>
      </>}
    >
      {phase === "confirm" && <>
        <p style={{ marginTop: 0 }}>
          Claude builds a draft with this automation’s real skill and sends it to <b>#{modName}</b> for approval. Nothing is posted to members.
        </p>
        <div className="rows">
          <div><span className="grow muted">Live channel</span><b>#{chName(s.channel)}</b></div>
          <div><span className="grow muted">Test goes to</span><b>#{modName}</b></div>
          <div><span className="grow muted">Schedule</span><span className="pill">{scheduleText(a, s)}</span></div>
          <div><span className="grow muted">Approval</span><span className="pill line">{MODE_LABEL[s.mode]}</span></div>
        </div>
      </>}
      {phase === "building" && (
        <div className="drafting" style={{ marginBottom: 0 }}>
          <span className="ndisc">…</span>
          <span><b>Claude is building it</b><span className="muted" style={{ display: "block" }}>Using {a.skill || "the automation’s skill"} with live Cruva data</span></span>
        </div>
      )}
      {phase === "ready" && <>
        <p className="muted" style={{ marginTop: 0 }}>Here’s how it will look. Approve it from Approvals to post it to #{draft.channelName || modName}.</p>
        <DiscordPreview botName={cfg.botName} messages={draftMsgs(draft)} />
      </>}
    </Modal>
  );
}
