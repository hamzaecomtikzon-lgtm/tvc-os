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

const back = (n) => ymd(addDays(todayUTC(), -n));
const monthStart = (d, shift = 0) => ymd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + shift, 1)));
/** Date range presets: `[key, label, () => [from, to]]`. */
export const PRESETS = [
  ["today", "Today", () => [back(0), back(0)]],
  ["yesterday", "Yesterday", () => [back(1), back(1)]],
  ["7", "Last 7 days", () => [back(6), back(0)]],
  ["14", "Last 14 days", () => [back(13), back(0)]],
  ["30", "Last 30 days", () => [back(29), back(0)]],
  ["week", "Last week (Sun–Sat)", () => { const t = todayUTC(); const s = addDays(t, -t.getUTCDay() - 7); return [ymd(s), ymd(addDays(s, 6))]; }],
  ["month", "This month", () => [monthStart(todayUTC()), back(0)]],
  ["lmonth", "Last month", () => [monthStart(todayUTC(), -1), ymd(addDays(monthStart(todayUTC()), -1))]],
  ["90", "Last 90 days", () => [back(89), back(0)]],
];

export function presetRange(key) {
  const p = PRESETS.find((x) => x[0] === key) || PRESETS[2];
  const [from, to] = p[2]();
  return { key: p[0], from, to };
}

/** "Last 7 days · Nov 5 – Nov 11, 2026" */
export function rangeText({ key, from, to }) {
  const p = PRESETS.find((x) => x[0] === key);
  return (p ? p[1] + " · " : "") + (from === to ? `${fmtDate(from)}, ${to.slice(0, 4)}` : rangeLabel(from, to));
}

export const initials = (s) => String(s || "?").replace(/[^a-z0-9 ]/gi, " ").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";

/** "2m ago", "3h ago", "Nov 5". */
export function ago(iso) {
  if (!iso) return "";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "Just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return fmtDate(iso);
}

/** Save rows as a CSV file. `rows` is an array of arrays; the first is the header. */
export function downloadCsv(name, rows) {
  const cell = (v) => { const t = String(v ?? ""); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const url = URL.createObjectURL(new Blob([rows.map((r) => r.map(cell).join(",")).join("\n")], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
