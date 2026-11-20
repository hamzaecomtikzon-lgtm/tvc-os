import { useState } from "react";
import { useApp } from "../context/app.js";
import { Ico, Sw } from "./ui.jsx";

const num = (v, d, lo, hi) => Math.min(hi, Math.max(lo, parseInt(v, 10) || d));

/** The sample follow-ups part of the automation editor: timing, the two messages, and a preview of who'd get one now. */
export function SamplesFields({ s, set }) {
  const { requestWait, crmLive } = useApp();
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const change = (patch) => { set(patch); setPreview(null); };

  const check = async () => {
    setLoading(true);
    setError("");
    const r = await requestWait("samples_preview", { settings: s });
    setLoading(false);
    if (!r.ok) return setError(r.error || "Couldn’t load the preview.");
    setPreview(r.result);
  };
  const rate = preview?.stats?.nudged ? Math.round((preview.stats.posted / preview.stats.nudged) * 100) : null;

  return (
    <>
      {!crmLive && <div className="hint warn"><Ico name="plug" /><div>Which samples are waiting on a video comes from your CRM. Right now that’s <b>sample data</b>, so no real creator will match. Connect Cruva in Settings → CRM first.</div></div>}

      <label className="field">First nudge<div style={{ display: "flex", gap: 8, alignItems: "center" }}><input className="input" type="number" min="1" max="30" style={{ width: 90 }} value={s.after ?? 5} onChange={(e) => change({ after: num(e.target.value, 5, 1, 30) })} /><span className="muted">days after the sample is delivered</span></div></label>
      <label className="field">Message<textarea className="input" value={s.text || ""} onChange={(e) => change({ text: e.target.value })} /><small>{"{first_name}"}, {"{product}"}, {"{days}"} (since delivery) and {"{due_date}"} are filled in for each creator.</small></label>

      <div className="trow" style={{ border: 0, padding: 0 }}><div><b>Second reminder</b><span>If they still haven’t posted</span></div><Sw checked={s.second !== false} label="Second reminder" onChange={(v) => change({ second: v })} /></div>
      {s.second !== false && (
        <>
          <label className="field">Second nudge<div style={{ display: "flex", gap: 8, alignItems: "center" }}><input className="input" type="number" min="3" max="60" style={{ width: 90 }} value={s.secondAfter ?? 12} onChange={(e) => change({ secondAfter: num(e.target.value, 12, 3, 60) })} /><span className="muted">days after delivery</span></div>{(s.secondAfter ?? 12) < (s.after ?? 5) + 2 && <small>Must be at least 2 days after the first nudge; it will be moved to day {(s.after ?? 5) + 2}.</small>}</label>
          <label className="field">Second message<textarea className="input" value={s.text2 || ""} onChange={(e) => change({ text2: e.target.value })} /></label>
        </>
      )}
      <p className="muted" style={{ fontSize: "var(--text-micro)" }}>Each sample gets at most {s.second !== false ? "two nudges" : "one nudge"}. Creators who post stop getting reminders automatically, and samples delivered more than 45 days ago are skipped.</p>

      <div className="field">Preview<small>Who would get a DM if it ran now. Nothing is sent.</small></div>
      <div><button className="btn sm" type="button" disabled={loading} onClick={check}><Ico name="chat" />{loading ? "Checking…" : preview ? "Check again" : "Check who’d get a DM"}</button></div>
      {error && <p className="err" role="alert">{error}</p>}
      {preview && (
        <div style={{ display: "grid", gap: 12 }}>
          <div className="dl">
            <div><span className="k">Waiting on a video</span><span className="v">{preview.pending} sample{preview.pending === 1 ? "" : "s"}{preview.source === "sample" ? " (sample data)" : ""}</span><span /></div>
            <div><span className="k">DMs now</span><span className="v">{preview.total}</span><span /></div>
            {preview.unlinked > 0 && <div><span className="k">Not in Discord</span><span className="v">{preview.unlinked} creator{preview.unlinked === 1 ? "" : "s"} due a nudge but not linked to a Discord member</span><span /></div>}
            {rate != null && <div><span className="k">Last 30 days</span><span className="v">{preview.stats.posted} of {preview.stats.nudged} nudged creators posted ({rate}%)</span><span /></div>}
          </div>
          {preview.nudges.length > 0 && (
            <div>
              {preview.nudges.slice(0, 8).map((c) => (
                <div key={c.applyId} className="lrow"><span className="cav">{(c.name || "?").slice(0, 1).toUpperCase()}</span><div><b>{c.name}</b><span className="sub">@{c.handle} · {c.product}</span></div><span className="num" style={{ fontFamily: "var(--font-sans)" }}>{c.n === 2 ? "2nd" : "1st"} · day {c.days}</span></div>
              ))}
            </div>
          )}
          {preview.examples.first && <div><div className="sec-t">Example DM</div><div className="hint" style={{ whiteSpace: "pre-wrap" }}>{preview.examples.first}</div></div>}
          {preview.examples.second && <div><div className="sec-t">Example second reminder</div><div className="hint" style={{ whiteSpace: "pre-wrap" }}>{preview.examples.second}</div></div>}
        </div>
      )}
    </>
  );
}
