import { useState } from "react";
import { useApp } from "../context/app.js";
import { defaultScoring } from "../lib/constants.js";

const WEIGHTS = [
  ["m", "Messages", "Messages that count: bursts within the cooldown count once, each day is capped."],
  ["rr", "Reactions received", "Reactions others left on their messages."],
  ["pr", "Replies received", "Replies from others to their messages."],
  ["ad", "Active days", "Days they posted at least one message."],
  ["rg", "Reactions given", "Reactions they added."],
  ["v", "Voice minutes", "Time in voice channels."],
];

export default function Scoring() {
  const { scoring, channels, guild, saveScoring, toast } = useApp();
  const roles = guild?.roles || [];
  const [f, setF] = useState(() => structuredClone(scoring));
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const toggleRole = (r) => set("excludedRoles", f.excludedRoles.includes(r) ? f.excludedRoles.filter((x) => x !== r) : [...f.excludedRoles, r]);

  const submit = async (e) => {
    e.preventDefault();
    const w = {};
    WEIGHTS.forEach(([k]) => (w[k] = Math.max(0, Math.min(10, parseFloat(f.w[k]) || 0))));
    const next = { cap: parseInt(f.cap, 10) || 50, cooldown: parseInt(f.cooldown, 10) || 0, excludedChannels: f.excludedChannels, excludedRoles: f.excludedRoles, w };
    if (await saveScoring(next)) toast("Scoring saved");
  };

  return (
    <section className="card">
      <div className="head"><h2>How the leaderboard counts</h2><span className="muted">Applies to every Community view</span></div>
      <form className="form" onSubmit={submit}>
        <label className="field"><span>Daily message cap</span><input type="number" min="1" value={f.cap} onChange={(e) => set("cap", e.target.value)} /></label>
        <label className="field"><span>Cooldown (seconds)</span><input type="number" min="0" value={f.cooldown} onChange={(e) => set("cooldown", e.target.value)} /></label>
        <label className="field span">
          <span>Excluded channels</span>
          <select multiple size={6} style={{ minHeight: 140 }} value={f.excludedChannels}
            onChange={(e) => set("excludedChannels", Array.from(e.target.selectedOptions).map((o) => o.value))}>
            {channels.map((c) => <option key={c.id} value={c.name}>#{c.name}</option>)}
          </select>
          <small>Ctrl/Cmd-click to select several</small>
        </label>
        <div className="field span">
          <span>Excluded roles</span>
          <div className="checks">
            {roles.length ? roles.map((r) => (
              <label key={r} className="chk"><input type="checkbox" checked={f.excludedRoles.includes(r)} onChange={() => toggleRole(r)} />{r}</label>
            )) : <span className="muted">No roles found in the server.</span>}
          </div>
        </div>
        {WEIGHTS.map(([k, l, d]) => (
          <label key={k} className="field">
            <span>{l} weight</span>
            <input type="number" step="0.5" min="0" max="10" value={f.w[k]} onChange={(e) => set("w", { ...f.w, [k]: e.target.value })} />
            <small>{d}</small>
          </label>
        ))}
        <div className="span row-actions">
          <button className="btn primary">Save Scoring</button>
          <button className="btn ghost" type="button" onClick={() => setF(defaultScoring())}>Reset to defaults</button>
        </div>
      </form>
    </section>
  );
}
