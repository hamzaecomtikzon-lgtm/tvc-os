import { useEffect, useRef, useState } from "react";
import { useApp } from "../context/app.js";
import { PATHS } from "./site.jsx";
import { discordMd } from "../lib/discordMarkdown.js";
import { PRESETS, daysBetween, fmtDate, rangeText, todayUTC, ymd } from "../lib/format.js";

export function Ico({ name, className = "ico" }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true">{PATHS[name]}</svg>;
}

export function PageHead({ title, desc, children }) {
  return (
    <div className="ph">
      <div><h1>{title}</h1>{desc && <p>{desc}</p>}</div>
      <div className="r">{children}</div>
    </div>
  );
}

export function Sw({ checked, onChange, label, disabled }) {
  return (
    <label className="sw" title={label} onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={!!checked} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

/** Period-over-period change chip. Renders nothing when there's nothing to compare with. */
export function Chg({ now, prev, pct }) {
  const p = pct ?? (prev ? ((now - prev) / prev) * 100 : null);
  if (p == null || isNaN(p)) return null;
  return <span className={"chg " + (p >= 0 ? "up" : "dn")}>{p >= 0 ? "▲" : "▼"} {Math.abs(p).toFixed(0)}%</span>;
}

export function KBox({ label, value, sub, tip, chip }) {
  return (
    <div className="kp">
      <div className="l"><span>{label} {tip && <span className="info" tabIndex={0} title={tip} aria-label={tip}>i</span>}</span>{chip}</div>
      <div className="v">{value}</div>
      {sub != null && <div className="s">{sub}</div>}
    </div>
  );
}

export function Empty({ title, children }) {
  return <div className="empty">{title && <b>{title}</b>}{children}</div>;
}

export function Skel({ n = 4 }) {
  return Array.from({ length: n }, (_, i) => <div key={i} className="skel" />);
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([k, label, extra]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} className={value === k ? "on" : ""} onClick={() => onChange(k)}>{label}{extra}</button>
      ))}
    </div>
  );
}

/** Closes on Escape. */
function useEscape(onClose) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
}

export function Drawer({ title, onClose, children, footer }) {
  useEscape(onClose);
  return (
    <>
      <div className="drawer-bg" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <header><h3>{title}</h3><button className="btn sm ghost x" type="button" onClick={onClose} aria-label="Close"><Ico name="x" /></button></header>
        <div className="db">{children}</div>
        {footer && <footer>{footer}</footer>}
      </aside>
    </>
  );
}

export function Dialog({ title, onClose, children, actions }) {
  useEscape(onClose);
  return (
    <div className="dlg" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h3>{title}</h3>
        {children}
        <div className="acts">{actions}</div>
      </div>
    </div>
  );
}

/** A popover anchored to its trigger; closes on outside click or Escape. `button(toggle)` renders the trigger. */
export function Pop({ button, children, className = "pop" }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div className="rel" ref={box}>
      {button(() => setOpen((o) => !o), open)}
      {open && <div className={className}>{typeof children === "function" ? children(() => setOpen(false)) : children}</div>}
    </div>
  );
}

export function BotAvatar() {
  const { botName, botAvatar } = useApp();
  return botAvatar ? <img src={botAvatar} alt="" /> : (botName[0] || "K").toUpperCase();
}

/** Messages as they will look in Discord. `messages` is `[{ text, images? }]`. */
export function Dc({ channel, dm, messages, time = "Scheduled" }) {
  const { botName } = useApp();
  return (
    <div className="dc">
      <div className="chan"><Ico name={dm ? "chat" : "hash"} />{dm ? "Direct message to each creator" : channel || "channel"}</div>
      <div className="msg">
        <div className="av"><BotAvatar /></div>
        <div style={{ minWidth: 0, display: "grid", gap: 10 }}>
          <div className="who">{botName} <small>APP</small> {time && <time>{time}</time>}</div>
          {messages.map((m, i) => (
            <div key={i} className="body">
              <span dangerouslySetInnerHTML={{ __html: discordMd(m.text) }} />
              {(m.images || []).map((u, j) => <img key={j} src={u} alt="Card attached to this message" loading="lazy" />)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Toast() {
  const { toastMsg } = useApp();
  return <div className="toast" role="status" hidden={!toastMsg}><Ico name="check" /><span>{toastMsg}</span></div>;
}

/** Channel picker grouped by Discord category. `none` is the label of the empty choice; `dm` adds direct messages. */
export function ChanSelect({ id, value, onChange, none = "No channel", dm, disabled }) {
  const { channels } = useApp();
  const groups = {};
  channels.forEach((c) => (groups[c.category || "No category"] = groups[c.category || "No category"] || []).push(c));
  return (
    <select className="input" id={id} value={value || ""} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">{none}</option>
      {dm && <option value="dm">Direct message to each creator</option>}
      {Object.entries(groups).map(([g, cs]) => (
        <optgroup key={g} label={g}>
          {cs.map((c) => <option key={c.id} value={c.id}>#{c.name}{c.canPost === false ? " · bot can’t post here" : ""}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

/* ---------- date range ---------- */
const utc = (s) => new Date(s + "T00:00:00Z");
const monthOf = (s, shift = 0) => { const d = utc(s); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + shift, 1)); };

function Month({ first, nav, T, onDay, onMove }) {
  const today = ymd(todayUTC());
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const cells = [];
  for (let d = 1; d <= last; d++) {
    const day = ymd(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), d)));
    const edge = day === T.from || day === T.to;
    const inside = T.to && day > T.from && day < T.to;
    cells.push(<button key={d} type="button" className={(edge ? "edge" : inside ? "in" : "") + (day === today ? " today" : "")} disabled={day > today} onClick={() => onDay(day)}>{d}</button>);
  }
  return (
    <div className="mon">
      <h5>
        {nav === "l" ? <button type="button" aria-label="Previous month" onClick={() => onMove(-1)}><Ico name="back" /></button> : <span className="ph-sp" />}
        <span>{first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</span>
        {nav === "r" ? <button type="button" aria-label="Next month" onClick={() => onMove(1)}><Ico name="arrow" /></button> : <span className="ph-sp" />}
      </h5>
      <div className="days">
        {"SMTWTFS".split("").map((d, i) => <span key={i} className="dw">{d}</span>)}
        {Array.from({ length: first.getUTCDay() }, (_, i) => <span key={"b" + i} />)}
        {cells}
      </div>
    </div>
  );
}

function RangePanel({ close }) {
  const { range, setRange, cfg } = useApp();
  const [T, setT] = useState({ ...range, view: ymd(monthOf(range.to)) });
  const preset = (k) => {
    if (k === "custom") return setT((t) => ({ ...t, key: "custom", to: "" }));
    const [from, to] = PRESETS.find((p) => p[0] === k)[2]();
    setT({ key: k, from, to, view: ymd(monthOf(to)) });
  };
  const onDay = (day) => setT((t) => (!t.to
    ? { ...t, key: "custom", from: day < t.from ? day : t.from, to: day < t.from ? t.from : day }
    : { ...t, key: "custom", from: day, to: "" }));
  const typed = (which, val) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(val) || isNaN(utc(val))) return;
    setT((t) => {
      let from = which === "from" ? val : t.from, to = which === "to" ? val : t.to;
      if (to && to < from) [from, to] = [to, from];
      return { key: "custom", from, to, view: ymd(monthOf(to || from)) };
    });
  };
  return (
    <>
      <div className="dr-pre">
        {PRESETS.map(([k, l]) => <button key={k} type="button" className={T.key === k ? "on" : ""} onClick={() => preset(k)}>{l}</button>)}
        <button type="button" className={T.key === "custom" ? "on" : ""} onClick={() => preset("custom")}>Custom range</button>
      </div>
      <div className="dr-cal">
        <div className="dr-head">
          <input className="input" key={"f" + T.from} defaultValue={T.from} aria-label="Start date" onBlur={(e) => typed("from", e.target.value)} />
          <span className="muted">→</span>
          <input className="input" key={"t" + T.to} defaultValue={T.to} placeholder="End date" aria-label="End date" onBlur={(e) => typed("to", e.target.value)} />
        </div>
        <div className="dr-months">
          <Month first={monthOf(T.view, -1)} nav="l" T={T} onDay={onDay} onMove={(n) => setT((t) => ({ ...t, view: ymd(monthOf(t.view, n)) }))} />
          <Month first={monthOf(T.view)} nav="r" T={T} onDay={onDay} onMove={(n) => setT((t) => ({ ...t, view: ymd(monthOf(t.view, n)) }))} />
        </div>
        <div className="dr-foot">
          <span>{T.to ? daysBetween(T.from, T.to) + 1 + " days" : "Pick an end date"} · {cfg.timezone}</span>
          <button className="btn sm" type="button" onClick={close}>Cancel</button>
          <button className="btn sm primary" type="button" disabled={!T.to} onClick={() => { setRange({ key: T.key, from: T.from, to: T.to }); close(); }}>Apply</button>
        </div>
      </div>
    </>
  );
}

export function DateRange() {
  const { range } = useApp();
  return (
    <Pop className="dr-pop" button={(toggle) => (
      <button className="btn dr-btn" type="button" aria-haspopup="dialog" onClick={toggle}><Ico name="calendar" /><span>{rangeText(range)}</span><Ico name="chev" /></button>
    )}>
      {(close) => <RangePanel close={close} />}
    </Pop>
  );
}

/* ---------- line chart ---------- */
let chartIds = 0;
/** Smooth daily lines. `data` is `[{ date, ...values }]`, `keys` is `[{ k, c }]` (value field, CSS color). */
export function LineChart({ data, keys, h = 180, money }) {
  const [id] = useState(() => "lg" + ++chartIds);
  if (!data.length) return <Empty>No daily data for this range.</Empty>;
  const W = 640, H = h, padL = 44, padB = 22, padT = 10;
  const max = Math.max(1, ...data.flatMap((p) => keys.map((k) => p[k.k] || 0))) * 1.12;
  const x = (i) => padL + (data.length === 1 ? (W - padL) / 2 : (i * (W - padL - 8)) / (data.length - 1));
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const fmt = (v) => (money ? money(v, true) : Math.round(v).toLocaleString("en-US"));
  const step = Math.max(1, Math.ceil(data.length / 6));
  const smooth = (pts) => {
    if (pts.length < 3) return "M" + pts.map((p) => p.join(",")).join(" L");
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0]},${p2[1]}`;
    }
    return d;
  };
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: H }} role="img" aria-label="Chart">
      <defs>
        {keys.map((k, i) => (
          <linearGradient key={i} id={`${id}-${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: k.c, stopOpacity: i ? 0.08 : 0.2 }} /><stop offset="1" style={{ stopColor: k.c, stopOpacity: 0 }} />
          </linearGradient>
        ))}
      </defs>
      {[0, 0.5, 1].map((t) => {
        const v = (max / 1.12) * t;
        return <g key={t}><line x1={padL} x2={W} y1={y(v)} y2={y(v)} style={{ stroke: "var(--color-border)" }} strokeDasharray={t ? "3 4" : "0"} /><text x={padL - 8} y={y(v) + 3} textAnchor="end">{fmt(v)}</text></g>;
      })}
      {data.map((p, i) => (i % step === 0 || i === data.length - 1) && <text key={i} x={x(i)} y={H - 6} textAnchor="middle">{fmtDate(p.date)}</text>)}
      {keys.map((k, ki) => {
        const pts = data.map((p, i) => [+x(i).toFixed(1), +y(p[k.k] || 0).toFixed(1)]);
        const d = smooth(pts), lp = pts[pts.length - 1];
        return (
          <g key={ki}>
            <path d={`${d} L${lp[0]},${H - padB} L${pts[0][0]},${H - padB}Z`} fill={`url(#${id}-${ki})`} />
            <path d={d} fill="none" style={{ stroke: k.c }} strokeWidth="2.2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={lp[0]} cy={lp[1]} r="4" style={{ fill: k.c, stroke: "var(--color-surface)" }} strokeWidth="2" />
          </g>
        );
      })}
    </svg>
  );
}

