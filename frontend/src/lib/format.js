export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const ymd = (d) => d.toISOString().slice(0, 10);

export const addDays = (d, n) => {
  const x = new Date(typeof d === "string" ? d + "T00:00:00Z" : d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
};

export const todayUTC = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
};

export const fmtDate = (s) => {
  if (!s) return "";
  const [, m, d] = s.slice(0, 10).split("-").map(Number);
  return MON[m - 1] + " " + d;
};

export const fmtTime = (s) => {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d)) return String(s);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

export const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);

export const dateList = (a, b) => {
  const out = [];
  for (let d = a; d <= b; d = ymd(addDays(d, 1))) out.push(d);
  return out;
};

export const int = (v) => (v == null || isNaN(v) ? "—" : Math.round(v).toLocaleString());
export const pct = (v) => (v == null || isNaN(v) ? "—" : Math.round(v) + "%");

export const fmtSecs = (s) =>
  s == null ? "—" : s < 3600 ? Math.round(s / 60) + "m" : s < 86400 ? (s / 3600).toFixed(s < 36000 ? 1 : 0) + "h" : (s / 86400).toFixed(1) + "d";

export function moneyFormatter(region) {
  const sym = region === "uk" ? "£" : "$";
  return (v, compact) => {
    if (v == null || isNaN(v)) return "—";
    if (compact && Math.abs(v) >= 1000) return sym + (v / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1) + "k";
    return sym + v.toLocaleString(undefined, { minimumFractionDigits: v < 100 && v % 1 ? 2 : 0, maximumFractionDigits: v < 100 ? 2 : 0 });
  };
}

export const rangeLabel = (from, to) => (from && to ? `${fmtDate(from)} – ${fmtDate(to)}, ${to.slice(0, 4)}` : "");

/** Period-over-period change as { dir, pct } with pct always positive. */
export function change(now, prev) {
  if (prev == null || prev === 0) return now > 0 ? { dir: "up", pct: 100 } : { dir: null, pct: null };
  const p = ((now - prev) / prev) * 100;
  return { dir: p >= 0 ? "up" : "down", pct: Math.abs(p) };
}

export function presetRange(key) {
  const end = addDays(todayUTC(), -1);
  return { key, to: ymd(end), from: ymd(addDays(end, -(parseInt(key, 10) - 1))) };
}
