import { useState } from "react";
import { useApp } from "../context/app.js";
import { Ico, Sw } from "./ui.jsx";

const WINDOWS = [[30, "Last 30 days"], [90, "Last 90 days"], [365, "Last 12 months"]];
const newId = () => "t" + Math.random().toString(36).slice(2, 9);
const label = (t) => (t?.emoji ? t.emoji + " " : "") + (t?.name || "");

/** The creator-tiers part of the automation editor: tiers, GMV window, options, and a live preview of who lands where. */
export function TiersFields({ s, set }) {
  const { requestWait, money, guild, crmLive } = useApp();
  const tiers = s.tiers || [];
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const setTier = (i, patch) => { set({ tiers: tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) }); setPreview(null); };
  const remove = (i) => { set({ tiers: tiers.filter((_, j) => j !== i) }); setPreview(null); };
  const add = () => {
    const top = Math.max(0, ...tiers.map((t) => Number(t.min) || 0));
    set({ tiers: [...tiers, { id: newId(), name: "", emoji: "⭐", color: "#9b59b6", min: top ? top * 2 : 500 }] });
  };
  const check = async () => {
    setLoading(true);
    setError("");
    const r = await requestWait("tiers_preview", { settings: s });
    setLoading(false);
    if (!r.ok) return setError(r.error || "Couldn’t load the preview.");
    setPreview(r.result);
  };
  const sorted = [...tiers].sort((a, b) => (Number(a.min) || 0) - (Number(b.min) || 0));
  const byId = Object.fromEntries(tiers.map((t) => [t.id, t]));
  const canRoles = preview?.canManageRoles ?? guild?.canManageRoles;

  return (
    <>
      {canRoles === false && <div className="hint warn"><Ico name="shield" /><div><b>The bot can’t manage roles yet.</b> In Discord, open Server Settings → Roles, give the bot’s role <b>Manage Roles</b>, and keep it above the tier roles. Kreo creates the tier roles the first time changes are approved.</div></div>}
      {!crmLive && <div className="hint warn"><Ico name="plug" /><div>Tiers use each creator’s GMV from your CRM. Right now that’s <b>sample data</b>, so real creators won’t match. Connect Cruva in Settings → CRM first.</div></div>}

      <div className="field">Tiers<small>A creator gets the highest tier whose GMV they’ve reached. Each tier becomes a Discord role.</small></div>
      <div style={{ display: "grid", gap: 8 }}>
        {tiers.map((t, i) => (
          <div key={t.id} style={{ display: "grid", gridTemplateColumns: "52px minmax(0, 1fr) 44px 110px 34px", gap: 6, alignItems: "center" }}>
            <input className="input" aria-label="Emoji" value={t.emoji || ""} maxLength={8} style={{ textAlign: "center", padding: "0 4px" }} onChange={(e) => setTier(i, { emoji: e.target.value })} />
            <input className="input" aria-label="Tier name" placeholder="Tier name" value={t.name} maxLength={40} onChange={(e) => setTier(i, { name: e.target.value })} />
            <input className="input" aria-label="Role colour" type="color" value={t.color || "#99aab5"} style={{ padding: 3 }} onChange={(e) => setTier(i, { color: e.target.value })} />
            <input className="input" aria-label="GMV from" type="number" min="0" step="100" value={t.min} onChange={(e) => setTier(i, { min: Math.max(0, parseInt(e.target.value, 10) || 0) })} />
            <button className="btn sm ghost" type="button" aria-label={`Remove ${t.name || "tier"}`} disabled={tiers.length <= 1} onClick={() => remove(i)}><Ico name="x" /></button>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span className="muted" style={{ fontSize: "var(--text-micro)" }}>Emoji · name · role colour · GMV from</span>
          <button className="btn sm" type="button" disabled={tiers.length >= 8} onClick={add}><Ico name="plus" />Add tier</button>
        </div>
      </div>

      <label className="field">Count GMV over<select className="input" value={s.window || 30} onChange={(e) => { set({ window: Number(e.target.value) }); setPreview(null); }}>{WINDOWS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select><small>Rolling window, checked every day.</small></label>
      <div className="trow" style={{ border: 0, padding: 0 }}><div><b>Move creators down too</b><span>When sales drop below their tier. Off: a tier, once reached, is kept.</span></div><Sw checked={s.demote !== false} label="Move creators down too" onChange={(v) => { set({ demote: v }); setPreview(null); }} /></div>
      <div className="trow" style={{ border: 0, padding: 0 }}><div><b>DM creators who move up</b><span>A short congratulations from the bot</span></div><Sw checked={s.dm !== false} label="DM creators who move up" onChange={(v) => set({ dm: v })} /></div>

      <div className="field">Preview<small>Who lands in each tier with these settings. Nothing changes in Discord.</small></div>
      <div><button className="btn sm" type="button" disabled={loading} onClick={check}><Ico name="users" />{loading ? "Checking…" : preview ? "Check again" : "Check who’s in each tier"}</button></div>
      {error && <p className="err" role="alert">{error}</p>}
      {preview && (
        <div style={{ display: "grid", gap: 12 }}>
          <div className="dl">
            {sorted.map((t) => <div key={t.id}><span className="k">{label(t)}</span><span className="v">{money(Number(t.min) || 0)}+</span><span className="pill line">{preview.count[t.id] ?? 0}</span></div>)}
          </div>
          <p className="muted" style={{ fontSize: "var(--text-micro)" }}>
            {preview.linked} linked creator{preview.linked === 1 ? "" : "s"} · GMV {preview.from} to {preview.to}{preview.source === "sample" ? " (sample data)" : ""}.
            {preview.unlinked > 0 && ` ${preview.unlinked} creator${preview.unlinked === 1 ? "" : "s"} with sales aren’t linked to a Discord member yet; they’re linked when they give their TikTok handle in the onboarding DM.`}
          </p>
          {preview.changes.length > 0 ? (
            <div>
              <div className="sec-t">Would move on the next run ({preview.changes.length})</div>
              {preview.changes.slice(0, 8).map((c) => (
                <div key={c.userId} className="lrow"><span className="cav">{(c.name || "?").slice(0, 1).toUpperCase()}</span><div><b>{c.name}</b><span className="sub">@{c.handle} · {money(c.gmv)}</span></div><span className="num" style={{ fontFamily: "var(--font-sans)" }}>{c.current ? label(byId[c.current]) : "—"} → {c.target ? label(byId[c.target]) : "none"}</span></div>
              ))}
            </div>
          ) : <p className="muted" style={{ fontSize: "var(--text-small)" }}>Everyone linked is already in the right tier.</p>}
          {preview.near.length > 0 && (
            <div>
              <div className="sec-t">Closest to the next tier</div>
              {preview.near.map((c) => (
                <div key={c.userId} className="lrow"><span className="cav r">{(c.name || "?").slice(0, 1).toUpperCase()}</span><div><b>{c.name}</b><span className="sub">@{c.handle} · {money(c.gmv)}</span></div><span className="num" style={{ fontFamily: "var(--font-sans)" }}>{money(c.gap)} to {label(byId[c.next])}</span></div>
              ))}
            </div>
          )}
          {preview.state?.failed > 0 && <div className="hint warn"><Ico name="shield" /><div><b>Last run: {preview.state.failed} change{preview.state.failed === 1 ? "" : "s"} failed.</b> {preview.state.errors?.[0]}</div></div>}
        </div>
      )}
    </>
  );
}
