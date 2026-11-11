import { useApp } from "../context/app.js";
import { errMsg } from "../lib/errors.js";
import { DAYS } from "../lib/format.js";
import { discordMd } from "../lib/discordMarkdown.js";

export function Hero({ eyebrow, title, lede, right }) {
  return (
    <section className="hero">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="title">{title}</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
      {right}
    </section>
  );
}

export function Skel({ n = 4 }) {
  return Array.from({ length: n }, (_, i) => <div key={i} className="skel" />);
}

export function Info({ text }) {
  return <span className="info" title={text} aria-label={text} role="img">i</span>;
}

export function Chg({ dir, pct }) {
  if (pct == null || isNaN(pct)) return <span className="chg flat">—</span>;
  if (Math.abs(pct) < 0.05) return <span className="chg flat">no change</span>;
  const up = dir === "up";
  return <span className={"chg " + (up ? "up" : "down")}>{up ? "▲" : "▼"} {Math.abs(pct).toFixed(Math.abs(pct) >= 100 ? 0 : 1)}%</span>;
}

export function Kpi({ label, tip, value, chg, sub, loading }) {
  return (
    <div className="kpi">
      <span className="l">{label} {tip && <Info text={tip} />}</span>
      {loading ? <Skel n={2} /> : <>
        <span className="v">{value}</span>
        {chg}
        {sub != null && <span className="s">{sub}</span>}
      </>}
    </div>
  );
}

export function Empty({ title, children }) {
  return <div className="empty">{title && <b>{title}</b>}{children}</div>;
}

export function Err({ error, children }) {
  return <div className="err">{children || errMsg(error)}</div>;
}

export function Callout({ icon = "i", children, style }) {
  return <div className="callout" style={style}><div className="disc" aria-hidden="true">{icon}</div><div>{children}</div></div>;
}

export function Switch({ checked, onChange, label }) {
  return (
    <button type="button" className="switch" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

/** Channel picker grouped by Discord category. */
export function ChanSelect({ id, value, onChange, allowNone }) {
  const { channels } = useApp();
  const groups = {};
  channels.forEach((c) => (groups[c.category] = groups[c.category] || []).push(c));
  return (
    <select id={id} value={value || ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">{allowNone ? "Off (no channel)" : "Choose a channel…"}</option>
      {Object.entries(groups).map(([g, cs]) => (
        <optgroup key={g} label={g}>
          {cs.map((c) => (
            <option key={c.id} value={c.id}>#{c.name}{c.canPost === false ? " · bot can’t see it" : ""}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function DayChecks({ value, onChange }) {
  const toggle = (d) => onChange(value.includes(d) ? value.filter((x) => x !== d) : DAYS.filter((x) => x === d || value.includes(x)));
  return (
    <div className="checks">
      {DAYS.map((d) => (
        <label key={d} className="chk"><input type="checkbox" checked={value.includes(d)} onChange={() => toggle(d)} />{d}</label>
      ))}
    </div>
  );
}

/** A Discord message as the bot will post it. */
export function DiscordPreview({ botName, messages, plain }) {
  return (
    <div className="discord">
      <div className="av" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div><b>{botName}</b> <span className="apptag">APP</span></div>
        {messages.map((m, i) => plain
          ? <div key={i} className="msg">{m.text}</div>
          : (
            <div key={i} className="msg">
              <span dangerouslySetInnerHTML={{ __html: discordMd(m.text) }} />
              {(m.images || []).map((u, j) => <img key={j} src={u} alt="Card attached to this message" loading="lazy" />)}
            </div>
          ))}
      </div>
    </div>
  );
}

export function Toast() {
  const { toastMsg } = useApp();
  return <div className="toast" role="status" hidden={!toastMsg}>{toastMsg}</div>;
}
