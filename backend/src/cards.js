/*
 * The winning-angle cards (numbers card and script card), rendered to PNG.
 * Layout is built as satori elements (flexbox → SVG), then rasterised with resvg.
 */
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { DEFAULT_THEME } from "./brandTheme.js";

const W = 1200; // layout width; the PNG is rendered at 2x
// Every card takes `d.theme` (see brandTheme.js): the brand's logo and colors. `green` is the brand's
// main color and `red` its second one; without a brand they keep the default green and red.
const themeOf = (d) => ({ ...DEFAULT_THEME, ...(d?.theme || {}) });

let fonts = null;
function loadFonts() {
  if (fonts) return fonts;
  const dir = join(dirname(createRequire(import.meta.url).resolve("@fontsource/plus-jakarta-sans/package.json")), "files");
  fonts = [];
  for (const weight of [400, 500, 600, 700, 800]) {
    for (const style of ["normal", "italic"]) {
      fonts.push({ name: "Jakarta", weight, style, data: readFileSync(join(dir, `plus-jakarta-sans-latin-${weight}-${style}.woff`)) });
    }
  }
  return fonts;
}

/** A satori element. `style` may be omitted; null/false children are dropped. */
function h(type, style, ...children) {
  const kids = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== "");
  return { type, props: { style: { display: "flex", ...style }, children: kids.length === 1 ? kids[0] : kids } };
}
const box = (style, ...c) => h("div", style, ...c);
const text = (style, ...c) => h("div", { flexWrap: "wrap", ...style }, ...c);
const span = (style, s) => ({ type: "span", props: { style, children: s } });

async function render(root, width, background) {
  const svg = await satori(root, { width, fonts: loadFonts() });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: width * 2 }, background }).render().asPng());
}

/* ---------- shared pieces ---------- */

/** Three bars in the brand's colors. `mid` is the middle bar (it matches the background it sits on). */
const bars = (C, height, mid = C.stripe[1], style = {}) =>
  box({ width: "100%", height, ...style }, box({ flex: 1, background: C.stripe[0] }), box({ flex: 1, background: mid }), box({ flex: 1, background: C.stripe[2] }));
const stripe = (C) => bars(C, 10);

/**
 * The company logo (Settings → Workspace), or nothing when there isn't one. It sits on a white tile at its own
 * shape (wide logos stay wide, nothing is cropped), so dark logos still show on the dark leaderboard.
 */
function logo(C, size, style = {}) {
  if (!C.logo) return null;
  const pad = Math.round(size * 0.12);
  const h = size - pad * 2;
  const w = Math.round(h * (C.logoAspect || 1));
  return box({ background: "#FFFFFF", borderRadius: Math.round(size * 0.24), padding: pad, alignItems: "center", justifyContent: "center", flexShrink: 0, ...style },
    { type: "img", props: { src: C.logo, width: w, height: h, style: { width: w, height: h, objectFit: "contain" } } });
}

/** Logo, then the brand name underlined in the brand's colors. */
const brandMark = (C, brand, { size, font, color = C.ink, underline, mid }) =>
  box({ alignItems: "center" },
    logo(C, size, { marginRight: Math.round(size * 0.28) }),
    box({ flexDirection: "column" },
      text({ fontSize: font, fontWeight: 500, color, letterSpacing: -font / 30 }, brand),
      bars(C, underline, mid, { marginTop: Math.max(3, underline - 1) })));

function header(C, brand, period) {
  return box({ justifyContent: "space-between", alignItems: C.logo ? "center" : "flex-start" },
    brandMark(C, brand, { size: 72, font: 44, underline: 5 }),
    box({ border: `2.5px solid ${C.ink}`, borderRadius: 40, padding: "10px 22px", fontSize: 18, fontWeight: 700, color: C.ink }, period),
  );
}
const pill = (C, label) => box({ alignSelf: "flex-start", background: C.ink, color: "#fff", borderRadius: 30, padding: "9px 20px", fontSize: 15, fontWeight: 800, letterSpacing: 2.5, marginTop: 34 }, label.toUpperCase());
const section = (C, label) => text({ fontSize: 17, fontWeight: 800, letterSpacing: 3.5, color: C.ink, marginTop: 40, marginBottom: 16 }, label.toUpperCase());
const panel = (C, style, ...c) => box({ flexDirection: "column", background: C.card, border: `2px solid ${C.line}`, borderRadius: 28, padding: 30, ...style }, ...c);
const page = (C, ...c) => box({ flexDirection: "column", width: W, background: C.bg, fontFamily: "Jakarta" }, stripe(C), box({ flexDirection: "column", padding: "34px 52px 56px" }, ...c));

const money = (sym, v) => sym + Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (v) => Math.round(v || 0).toLocaleString("en-US");
const pct = (v, d = 1) => `${Number(v || 0).toFixed(d)}%`;

/* ---------- numbers card ---------- */

/**
 * `d`: { brand, period, sym, handle, product, views, gmv, units, commission,
 *        ads: null | { spend, revenue, impressions, clicks, orders, rate2s, rate6s, spendRank } }
 */
export async function numbersCard(d) {
  const C = themeOf(d);
  const a = d.ads;
  const adViews = a ? Math.min(a.impressions, d.views || a.impressions) : 0;
  const totalViews = Math.max(d.views || 0, adViews);
  const adShare = totalViews ? adViews / totalViews : 0;
  const parts = [
    header(C, d.brand, d.period),
    pill(C, "#1 video by GMV"),
    text({ fontSize: 50, fontWeight: 800, color: C.ink, marginTop: 14, letterSpacing: -1, lineHeight: 1.15 },
      span({}, `@${d.handle}`), span({ color: C.muted, margin: "0 14px" }, "·"), span({ color: C.green }, d.product)),
  ];

  if (a) {
    const swiped = 100 - a.rate2s;
    const clickRate = a.impressions ? (a.clicks / a.impressions) * 100 : 0;
    const buyRate = a.clicks ? (a.orders / a.clicks) * 100 : 0;
    const bar = (label, widthPct, value, extra) =>
      box({ alignItems: "center", marginBottom: 16 },
        text({ width: 190, fontSize: 21, fontWeight: 700, color: C.ink }, label),
        box({ flex: 1, height: 32 }, box({ width: `${Math.max(2.4, Math.min(100, widthPct)) * 0.78}%`, height: 32, borderRadius: 9, background: C.ink })),
        text({ width: 230, justifyContent: "flex-end", fontSize: 21, fontWeight: 800, color: C.ink }, value, extra ? span({ color: C.muted, fontWeight: 600, marginLeft: 6 }, extra) : null),
      );
    parts.push(
      section(C, "The brand backed your video"),
      panel(C, {},
        box({ gap: 22 },
          box({ flex: 1, flexDirection: "column", border: `3px solid ${C.green}`, background: C.greenBg, borderRadius: 18, padding: "22px 26px" },
            text({ fontSize: 19, fontWeight: 700, color: C.green }, "Sales from the ads"),
            text({ fontSize: 58, fontWeight: 800, color: C.green, letterSpacing: -1.5, marginTop: 4 }, money(d.sym, a.revenue)),
            text({ fontSize: 17, fontWeight: 600, color: C.green, opacity: 0.85 }, "GMV this video made from ads")),
          box({ flex: 1, flexDirection: "column", border: `3px solid ${C.red}`, background: C.redBg, borderRadius: 18, padding: "22px 26px" },
            text({ fontSize: 19, fontWeight: 700, color: C.red }, "Ad spend on your video"),
            text({ fontSize: 58, fontWeight: 800, color: C.red, letterSpacing: -1.5, marginTop: 4 }, money(d.sym, a.spend)),
            text({ fontSize: 17, fontWeight: 600, color: C.red, opacity: 0.85 }, a.spendRank ? `#${a.spendRank} most-funded video this week` : "brand ad budget behind this video")),
        ),
        text({ justifyContent: "center", alignItems: "baseline", marginTop: 30 },
          span({ fontSize: 40, fontWeight: 800, color: C.ink }, int(totalViews)), span({ fontSize: 23, fontWeight: 700, color: C.ink, marginLeft: 10 }, "total views this week")),
        box({ height: 46, borderRadius: 14, overflow: "hidden", marginTop: 14, background: C.green },
          box({ width: `${Math.max(adShare * 100, 1)}%`, background: C.ink })),
        box({ justifyContent: "space-between", marginTop: 14 },
          box({ flexDirection: "column" },
            text({ fontSize: 17, fontWeight: 600, color: C.ink }, "Views from brand ads"),
            text({ fontSize: 30, fontWeight: 800, color: C.ink }, `~${int(adViews)} · ${Math.round(adShare * 100)}%`)),
          box({ flexDirection: "column", alignItems: "flex-end" },
            text({ fontSize: 17, fontWeight: 600, color: C.green }, "Views you got yourself"),
            text({ fontSize: 30, fontWeight: 800, color: C.green }, `~${int(totalViews - adViews)} · ${Math.round((1 - adShare) * 100)}%`)),
        ),
      ),
      section(C, "Where viewers dropped"),
      panel(C, { paddingTop: 34 },
        bar("Saw the ad", 100, int(a.impressions)),
        bar("Watched 2s", a.rate2s, pct(a.rate2s)),
        bar("Watched 6s", a.rate6s, pct(a.rate6s)),
        bar("Clicked", clickRate, pct(clickRate), `(${int(a.clicks)} people)`),
        bar("Bought", buyRate, pct(buyRate)),
        swiped >= 50
          ? text({ background: C.redBg, color: C.red, borderRadius: 14, padding: "16px 22px", fontSize: 21, fontWeight: 700, marginTop: 6 }, `${Math.round(swiped)}% swiped away in 2 seconds. A stronger hook = more sales.`)
          : text({ background: C.greenBg, color: C.green, borderRadius: 14, padding: "16px 22px", fontSize: 21, fontWeight: 700, marginTop: 6 }, `${Math.round(a.rate2s)}% stayed past 2 seconds. The hook works, so the brand keeps spending.`),
      ),
    );
  } else {
    parts.push(
      section(C, "How it sold"),
      panel(C, {},
        text({ alignItems: "baseline" }, span({ fontSize: 40, fontWeight: 800, color: C.ink }, int(d.views)), span({ fontSize: 23, fontWeight: 700, color: C.ink, marginLeft: 10 }, "views this week")),
        text({ fontSize: 20, fontWeight: 600, color: C.muted, marginTop: 8 }, "No brand ad spend on this video this week. Every sale came from views you earned yourself."),
      ),
    );
  }

  const stat = (label, value, good) =>
    box({ flex: 1, flexDirection: "column", background: good ? C.greenBg : C.card, border: `${good ? 3 : 2}px solid ${good ? C.green : C.line}`, borderRadius: 20, padding: "22px 26px" },
      text({ fontSize: 19, fontWeight: 700, color: good ? C.green : C.ink }, label),
      text({ fontSize: 50, fontWeight: 800, color: good ? C.green : C.ink, letterSpacing: -1, marginTop: 6 }, value));
  parts.push(section(C, "What you earned"), box({ gap: 20 }, stat("Your GMV", money(d.sym, d.gmv)), stat("Units sold", int(d.units)), stat("Commission", money(d.sym, d.commission), true)));
  return render(page(C, ...parts), W, C.bg);
}

/* ---------- script card ---------- */

/** Quote text with `highlight` (a substring) in green. */
function quoteLine(C, line, highlight, color) {
  // The quote marks ride on the first and last words so they never wrap onto a line of their own.
  const i = highlight ? line.toLowerCase().lastIndexOf(highlight.toLowerCase()) : -1;
  if (i < 0) return [span({ color }, `“${line}”`)];
  const tail = line.slice(i + highlight.length);
  return [
    span({ color }, "“" + line.slice(0, i)),
    span({ color: C.green }, line.slice(i, i + highlight.length) + (tail ? "" : "”")),
    tail ? span({ color }, tail + "”") : null,
  ].filter(Boolean);
}

/**
 * `d`: { brand, period, handle, angle: { line, highlight, translation, summary }, whyHeading,
 *        why: [{ title, note, body }], script: [{ label, line, translation, score?, badge? }],
 *        diagnosis: { headline, body }, opening: { line, translation, note } }
 */
export async function scriptCard(d) {
  const C = themeOf(d);
  const tr = (s, style) => (s ? text({ fontSize: 17, fontWeight: 500, color: C.muted, marginTop: 4, ...style }, `(${s})`) : null);
  const rows = d.script.map((r, i) => {
    const strong = r.score >= 8;
    return box({ alignItems: "center", padding: "18px 0", borderTop: i ? `2px solid ${C.line}` : "none" },
      text({ width: 210, fontSize: 16, fontWeight: 800, letterSpacing: 2.5, color: C.muted }, r.label.toUpperCase()),
      box({ flex: 1, flexDirection: "column", paddingRight: 20 },
        text({ fontSize: 25, fontWeight: 700, fontStyle: "italic", color: strong ? C.green : C.ink, lineHeight: 1.3 }, `“${r.line}”`),
        tr(r.translation)),
      r.score
        ? box({ borderRadius: 30, padding: "8px 18px", fontSize: 19, fontWeight: 800, background: r.score >= 9 ? C.green : C.greenBg, color: r.score >= 9 ? "#fff" : C.green }, `Hook ${r.score}/10`)
        : r.badge ? box({ borderRadius: 30, padding: "8px 18px", fontSize: 19, fontWeight: 800, background: C.redBg, color: C.red }, r.badge) : null,
    );
  });

  return render(page(C,
    header(C, d.brand, d.period),
    pill(C, "The winning angle"),
    text({ fontSize: 58, fontWeight: 800, color: C.ink, marginTop: 16, letterSpacing: -1.5, lineHeight: 1.12, whiteSpace: "pre-wrap" }, ...quoteLine(C, d.angle.line, d.angle.highlight, C.ink)),
    d.angle.translation ? text({ fontSize: 22, fontWeight: 600, color: C.muted, marginTop: 10 }, `(${d.angle.translation})`) : null,
    d.angle.summary ? text({ fontSize: 22, fontWeight: 500, color: C.muted, marginTop: 10 }, d.angle.summary) : null,
    section(C, d.whyHeading || "Why this angle sells"),
    box({ gap: 20 }, d.why.slice(0, 3).map((w) =>
      box({ flex: 1, flexDirection: "column", background: C.card, border: `2px solid ${C.line}`, borderRadius: 22, padding: "24px 26px" },
        text({ alignItems: "baseline", fontSize: 25, fontWeight: 800, color: C.green, lineHeight: 1.2 }, span({}, w.title), w.note ? span({ fontSize: 16, fontWeight: 600, marginLeft: 8 }, `(${w.note})`) : null),
        text({ fontSize: 18, fontWeight: 500, color: C.ink, marginTop: 10, lineHeight: 1.4 }, w.body)))),
    section(C, "The script, in order"),
    panel(C, { padding: "12px 34px" }, rows),
    section(C, "Same lines, better order"),
    box({ gap: 20 },
      box({ flex: 1, flexDirection: "column", background: C.redBg, border: `3px solid ${C.red}`, borderRadius: 24, padding: "30px 34px" },
        text({ fontSize: 62, fontWeight: 800, color: C.red, letterSpacing: -1.5, lineHeight: 1.05 }, d.diagnosis.headline),
        text({ fontSize: 23, fontWeight: 700, color: C.ink, marginTop: 12, lineHeight: 1.35 }, d.diagnosis.body)),
      box({ flex: 1.25, flexDirection: "column", background: C.ink, borderRadius: 24, padding: "30px 34px" },
        text({ fontSize: 16, fontWeight: 800, letterSpacing: 3, color: C.onInk }, "TRY THIS OPENING"),
        text({ fontSize: 29, fontWeight: 700, fontStyle: "italic", color: "#fff", marginTop: 14, lineHeight: 1.3 }, `“${d.opening.line}”`),
        tr(d.opening.translation, { color: C.onInkSoft, fontSize: 18, marginTop: 12 }),
        d.opening.note ? text({ fontSize: 18, fontWeight: 500, color: C.onInkSoft, marginTop: 14 }, d.opening.note) : null),
    ),
  ), W, C.bg);
}

/* ---------- creator win card ---------- */

const ordinal = (n) => n + ((n % 100 >= 11 && n % 100 <= 13) ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"));

/** Badge and tagline for a milestone. */
export function milestoneCopy(n, levels) {
  const known = { 1: ["NEW SELLER", "first sale unlocked"], 3: ["ON A ROLL", "hat trick"], 5: ["ON A ROLL", "high five"], 10: ["RISING", "double digits"], 25: ["TRENDING", "quarter century"], 30: ["TRENDING", "thirty and counting"], 50: ["TOP SELLER", "half a hundred"], 100: ["ELITE", "triple digits"] };
  if (known[n]) return known[n];
  const i = levels.indexOf(n);
  return [i >= levels.length - 1 ? "TOP SELLER" : i <= 0 ? "NEW SELLER" : "RISING", `${n} sales and counting`];
}

/** `d`: { brand, handle, n, levels } → PNG. The first sale is green; later milestones are navy. */
export async function winCard({ brand, handle, n, levels, theme }) {
  const C = themeOf({ theme });
  const WW = 700;
  const accent = n === 1 ? C.green : C.ink;
  const [badge, tagline] = milestoneCopy(n, levels);
  const big = n === 1 ? ordinal(1) : String(n);
  const unit = n === 1 ? "SALE" : "SALES";
  const track = levels.slice(0, 6);
  const node = (l) => {
    const done = l < n, here = l === n;
    const size = here ? 50 : 36;
    return box({ flexDirection: "column", alignItems: "center", width: 90 },
      box({ height: 56, alignItems: "center", justifyContent: "center" },
        box({ width: size, height: size, borderRadius: size, alignItems: "center", justifyContent: "center",
          background: done || here ? accent : "#fff", border: done || here ? "none" : `2.5px solid ${C.line}`,
          boxShadow: here ? `0 0 0 6px ${n === 1 ? C.ringSoft : C.ring2Soft}` : "none",
          fontSize: here ? 18 : 14, fontWeight: 800, color: done || here ? "#fff" : C.muted }, String(l))),
      text({ fontSize: 11, fontWeight: 800, letterSpacing: 1, color: done || here ? C.ink : "#B5B9C8", marginTop: 6 }, l === 1 ? "1ST SALE" : `${l} SALES`));
  };
  const seg = (l) => box({ flex: 1, height: 4, marginTop: 26, background: l <= n ? accent : C.line });
  const trackKids = [];
  track.forEach((l, i) => {
    if (i) trackKids.push(seg(l));
    trackKids.push(node(l));
  });

  const root = box({ flexDirection: "column", width: WW, background: "#F6F7F9", fontFamily: "Jakarta" },
    bars(C, 8, "#F6F7F9"),
    box({ flexDirection: "column", padding: "26px 40px 40px" },
      box({ justifyContent: "space-between", alignItems: "center" },
        brandMark(C, brand, { size: 46, font: 28, underline: 3 }),
        box({ border: `2px solid ${C.ink}`, borderRadius: 30, padding: "6px 14px", fontSize: 12, fontWeight: 800, letterSpacing: 1.5, color: C.ink }, "CREATOR WIN")),
      box({ flexDirection: "column", alignItems: "center", marginTop: 34 },
        box({ position: "relative", width: 220, height: 236, justifyContent: "center" },
          box({ width: 220, height: 220, borderRadius: 220, border: `6px solid ${n === 1 ? C.ring : C.ring2}`, background: "#E4E6EE", overflow: "hidden", alignItems: "flex-end", justifyContent: "center" },
            box({ position: "absolute", top: 46, left: 72, width: 64, height: 64, borderRadius: 64, background: "#fff" }),
            box({ width: 150, height: 80, borderRadius: "75px 75px 0 0", background: "#fff" })),
          box({ position: "absolute", bottom: 0, left: 0, width: 220, justifyContent: "center" },
            box({ background: accent, color: "#fff", borderRadius: 20, padding: "5px 14px", fontSize: 12, fontWeight: 800, letterSpacing: 1.2, border: "3px solid #F6F7F9" }, badge))),
        text({ fontSize: 26, fontWeight: 800, color: C.ink, marginTop: 22 }, `@${handle}`),
        text({ alignItems: "flex-end", marginTop: 6 },
          span({ fontSize: 112, fontWeight: 800, color: accent, letterSpacing: -5, lineHeight: 1 }, big),
          span({ fontSize: 40, fontWeight: 800, color: C.ink, marginLeft: 10, marginBottom: 10 }, unit)),
        text({ fontSize: 18, fontWeight: 700, color: C.muted, marginTop: 8 }, tagline)),
      box({ alignItems: "flex-start", marginTop: 44, padding: "0 4px" }, trackKids),
    ),
  );
  return render(root, WW, "#F6F7F9");
}

/* ---------- weekly leaderboard card ---------- */

/** `d`: { brand, period, sym, top: [{ handle, gmv }] } → PNG. Podium for the top 3, rows for the rest. */
export async function leaderCard({ brand, period, sym, top, theme }) {
  const C = themeOf({ theme });
  const WW = 700;
  const N = C.night;
  const MEDAL = [
    { ring: "#E9B949", block: "linear-gradient(180deg, #F2CF6B, #D9A93A)", text: "#3B2A05" },
    { ring: "#C9CEDB", block: "linear-gradient(180deg, #DADFEA, #AEB5C6)", text: "#2A3045" },
    { ring: "#D98A4E", block: "linear-gradient(180deg, #E8A06A, #C27138)", text: "#3A1E08" },
  ];
  const m = (v) => sym + Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const avatar = (size, ring, place) =>
    box({ position: "relative", width: size, height: size + 12, justifyContent: "center" },
      box({ width: size, height: size, borderRadius: size, border: `4px solid ${ring}`, background: N.line, overflow: "hidden", alignItems: "flex-end", justifyContent: "center" },
        box({ position: "absolute", top: size * 0.2, left: size / 2 - size * 0.16 - 4, width: size * 0.32, height: size * 0.32, borderRadius: size, background: N.face }),
        box({ width: size * 0.66, height: size * 0.34, borderRadius: `${size}px ${size}px 0 0`, background: N.face })),
      box({ position: "absolute", bottom: 0, left: size / 2 - 14, width: 28, height: 28, borderRadius: 28, background: ring, border: `3px solid ${N.bg}`, alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: N.bg }, String(place)));
  const podium = (i, blockH) => {
    const c = top[i];
    if (!c) return box({ width: 180 });
    const md = MEDAL[i];
    return box({ flexDirection: "column", alignItems: "center", width: 180 },
      avatar(i === 0 ? 110 : 84, md.ring, i + 1),
      text({ fontSize: i === 0 ? 17 : 15, fontWeight: 700, color: "#fff", marginTop: 10, maxWidth: 176, justifyContent: "center" }, `@${c.handle}`),
      text({ fontSize: i === 0 ? 30 : 24, fontWeight: 800, color: i === 0 ? md.ring : "#fff", marginTop: 2 }, m(c.gmv)),
      text({ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: N.soft, marginBottom: 12 }, "GMV"),
      box({ width: 168, height: blockH, borderRadius: "14px 14px 0 0", backgroundImage: md.block, justifyContent: "center", paddingTop: 14, fontSize: 18, fontWeight: 800, color: md.text }, `#${i + 1}`));
  };
  const rest = top.slice(3).map((c, j) =>
    box({ alignItems: "center", background: N.bg2, border: `1.5px solid ${N.line}`, borderRadius: 16, padding: "14px 20px", marginTop: j ? 10 : 0 },
      box({ width: 34, height: 34, borderRadius: 34, background: N.line, alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800, color: "#fff" }, String(j + 4)),
      text({ flex: 1, fontSize: 18, fontWeight: 700, color: "#fff", marginLeft: 14 }, `@${c.handle}`),
      text({ fontSize: 20, fontWeight: 800, color: "#fff" }, m(c.gmv))));

  const root = box({ flexDirection: "column", width: WW, background: N.bg, fontFamily: "Jakarta" },
    bars(C, 8),
    box({ flexDirection: "column", padding: "24px 36px 28px" },
      box({ justifyContent: "space-between", alignItems: "center" },
        brandMark(C, brand, { size: 44, font: 26, color: "#fff", underline: 3 }),
        box({ border: `1.5px solid ${N.soft}`, borderRadius: 30, padding: "6px 14px", fontSize: 13, fontWeight: 700, color: "#fff" }, period)),
      text({ justifyContent: "center", fontSize: 14, fontWeight: 800, letterSpacing: 4, color: "#E9B949", marginTop: 28 }, "LEADERBOARD"),
      box({ flexDirection: "column", alignItems: "center", fontSize: 56, fontWeight: 800, color: "#fff", lineHeight: 1.02, marginTop: 8, letterSpacing: -1 }, text({}, "WEEKLY TOP"), text({}, "CREATORS")),
      box({ justifyContent: "center", alignItems: "flex-end", marginTop: 34, gap: 8 }, podium(1, 74), podium(0, 110), podium(2, 52)),
      rest.length ? box({ flexDirection: "column", marginTop: 18 }, rest) : null,
      text({ justifyContent: "center", fontSize: 13, fontWeight: 600, color: N.soft, marginTop: 22 }, "ranked by GMV generated last week"),
    ),
  );
  return render(root, WW, N.bg);
}
