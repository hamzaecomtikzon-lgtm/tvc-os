import { useState } from "react";
import { useApp } from "../context/app.js";
import { SHOP_TABS, TABS } from "../lib/constants.js";

const RANGES = [["7", "7D"], ["14", "14D"], ["30", "30D"], ["90", "90D"], ["c", "Custom"]];

export default function Topbar({ tab }) {
  const { range, setRange, refresh, shop, guild, toast } = useApp();
  const [busy, setBusy] = useState(false);

  const onRefresh = () => {
    if (busy) return;
    setBusy(true);
    refresh();
    setTimeout(() => {
      setBusy(false);
      toast("Data refreshed");
    }, 900);
  };
  const ctx = SHOP_TABS.includes(tab) ? shop?.name : tab !== "welcome" ? guild?.guildName : "";

  const onDate = (which, val) => {
    const from = which === "from" ? val : range.from;
    const to = which === "to" ? val : range.to;
    if (from && to && from <= to) setRange("c", from, to);
  };

  return (
    <div className="top">
      <div className="inner topbar">
        <span className="where">{TABS[tab]}{ctx ? " · " + ctx : ""}</span>
        <div className="seg" role="group" aria-label="Date range">
          {RANGES.map(([k, l]) => (
            <button key={k} aria-pressed={range.key === k} onClick={() => setRange(k)}>{l}</button>
          ))}
        </div>
        {range.key === "c" && (
          <span className="custom-range">
            <label className="sr" htmlFor="from">From</label>
            <input type="date" id="from" value={range.from} max={range.to} onChange={(e) => onDate("from", e.target.value)} />
            <label className="sr" htmlFor="to">To</label>
            <input type="date" id="to" value={range.to} min={range.from} onChange={(e) => onDate("to", e.target.value)} />
          </span>
        )}
        <button className="btn sm" onClick={onRefresh} disabled={busy} aria-busy={busy}>
          {busy && <span className="spin" aria-hidden="true" />}
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </div>
  );
}
