import { useRef, useState } from "react";
import { fmtDate } from "../lib/format.js";

const W = 1000, H = 280, L = 58, R = 16, T = 14, B = 30;

/**
 * Multi-series daily line chart with hover crosshair + tooltip.
 * series: [{ name, color, pts: [{date, v}], area? }]
 */
export default function LineChart({ series, axisFmt, tipFmt }) {
  const svgRef = useRef(null);
  const [hi, setHi] = useState(null);
  const a = series[0].pts;
  if (!a.length) return <div className="empty">No daily data for this range.</div>;

  const max = Math.max(1, ...series.flatMap((s) => s.pts.map((p) => p.v)));
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  const nice = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => max / s <= 5) || mag * 10;
  const top = Math.ceil(max / nice) * nice;
  const x = (i) => L + (a.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (a.length - 1));
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const path = (pts) => pts.map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p.v).toFixed(1)).join(" ");
  const ticks = [];
  for (let t = 0; t <= top + 1e-9; t += nice) ticks.push(t);
  const every = Math.max(1, Math.ceil(a.length / 8));

  const onMove = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(a.length - 1, Math.round((px - L) / ((W - L - R) / Math.max(1, a.length - 1)))));
    setHi(i);
  };

  const hiTop = hi == null ? 0 : y(Math.max(...series.map((s) => (s.pts[hi] ? s.pts[hi].v : 0))));

  return (
    <div className="chartbox">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={series.map((s) => s.name).join(" and ") + " by day"}
        onPointerMove={onMove} onPointerLeave={() => setHi(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end">{axisFmt(t)}</text>
          </g>
        ))}
        {a.map((p, i) => ((i % every === 0 && a.length - 1 - i >= every / 2) || i === a.length - 1) && (
          <text key={p.date} x={x(i)} y={H - 8} textAnchor="middle">{fmtDate(p.date)}</text>
        ))}
        {series.map((s) => (
          <g key={s.name}>
            {s.area && <path d={`${path(s.pts)} L${x(s.pts.length - 1)} ${y(0)} L${x(0)} ${y(0)} Z`} fill={s.color} fillOpacity="0.10" />}
            <path d={path(s.pts)} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {s.pts.length > 0 && (
              <circle cx={x(s.pts.length - 1)} cy={y(s.pts[s.pts.length - 1].v)} r="4.5" fill={s.color} stroke="var(--card)" strokeWidth="2" />
            )}
          </g>
        ))}
        {hi != null && <line x1={x(hi)} x2={x(hi)} y1={T} y2={H - B} stroke="var(--muted)" strokeDasharray="3 3" />}
      </svg>
      {hi != null && (
        <div className="tip" style={{ left: (x(hi) / W) * 100 + "%", top: (hiTop / H) * 100 + "%" }}>
          <b>{fmtDate(a[hi].date)}</b>
          {series.map((s) => s.pts[hi] && <div key={s.name}>{s.name}: {tipFmt(s.pts[hi].v)}</div>)}
        </div>
      )}
    </div>
  );
}
