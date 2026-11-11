import { useState } from "react";
import { useApp } from "../context/app.js";
import { AUTOS } from "../lib/constants.js";

const NAV = [
  ["overview", "Overview"], ["content", "Content"], ["community", "Community"],
  ["automations", "Automations", "auto"], ["approvals", "Approvals", "draft"],
  ["onboarding", "Onboarding"], ["setup", "Bot & channels"], ["welcome", "Setup guide"],
];

export default function Rail({ tab }) {
  const { shops, shop, setShop, autos, drafts, guild, cruvaOk, bridgeOk, resetDemo } = useApp();
  const [confirm, setConfirm] = useState(false);
  const badge = {
    auto: AUTOS.filter((a) => autos[a.key]?.enabled).length,
    draft: drafts.filter((d) => d.status === "pending").length,
  };

  return (
    <aside className="rail" aria-label="Main">
      <div className="brandmark">
        <div className="disc" aria-hidden="true">TVC</div>
        <div><b>Creator OS</b><span>The Viral Circle · Pharmlitalia</span></div>
      </div>
      <div>
        <label className="rail-label" htmlFor="brand">BRAND (CRUVA)</label>
        <select id="brand" value={shop?.id || ""} onChange={(e) => setShop(e.target.value)} disabled={!shops.length}>
          {shops.length ? shops.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.region.toUpperCase()}</option>) : <option>{cruvaOk === false ? "No brands" : "Loading…"}</option>}
        </select>
      </div>
      <nav className="nav">
        {NAV.map(([k, label, b]) => (
          <a key={k} href={"#" + k} aria-current={tab === k ? "page" : undefined}>
            <span className="dot" />{label}{b && <small>{badge[b]}</small>}
          </a>
        ))}
      </nav>
      <div className="railfoot">
        <span className={"status" + (cruvaOk ? " ok" : "")}><i />{cruvaOk == null ? "Cruva: checking" : cruvaOk ? "Cruva connected" : "Cruva: not connected"}</span>
        <span className={"status" + (guild ? " ok" : "")}><i />{guild ? "Discord: " + guild.guildName : "Discord: not set up"}</span>
        <span className={"status" + (bridgeOk ? " ok" : "")}><i />{bridgeOk ? "Live link: on" : "Live link: off"}</span>
        <span style={{ marginTop: 8 }}>Demo data · stored in this browser</span>
        {confirm ? (
          <span style={{ display: "flex", gap: 10 }}>
            <button className="linkish" onClick={() => { setConfirm(false); resetDemo(); }}>Yes, reset everything</button>
            <button className="linkish" onClick={() => setConfirm(false)}>Cancel</button>
          </span>
        ) : (
          <button className="linkish" onClick={() => setConfirm(true)}>Reset demo</button>
        )}
      </div>
    </aside>
  );
}
