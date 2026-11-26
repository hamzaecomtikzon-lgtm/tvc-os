/*
 * The brand look for generated cards: the workspace's company logo (Settings → Workspace,
 * kept apart from the bot's picture) and a palette taken from it automatically.
 * Without a usable logo, cards keep the default palette.
 */
import { Resvg } from "@resvg/resvg-js";

/** The default palette (also the shape of every theme). */
export const DEFAULT_THEME = {
  logo: "", logoAspect: 1, bg: "#F1F2F5", card: "#FFFFFF", line: "#E3E5EB", ink: "#1E2549", muted: "#6B7090",
  green: "#0A9444", greenBg: "#E7F4EC", red: "#D3263A", redBg: "#FBEAEC", track: "#EEF0F4",
  stripe: ["#0A9444", "#FFFFFF", "#D3263A"], onInk: "#7FD4A0", onInkSoft: "#C5C9DD", ring: "#4CB476", ringSoft: "#CFEBDB", ring2: "#6F8A84", ring2Soft: "#D9DCE8",
  night: { bg: "#1C2350", bg2: "#232B5E", line: "#38417A", soft: "#AEB4D6", face: "#8C93BF" },
};

const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb) => "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("").toUpperCase();
/** `a` blended toward `b` by `t` (0 = a, 1 = b). */
const mix = (a, b, t) => toHex(toRgb(a).map((v, i) => v + (toRgb(b)[i] - v) * t));

function hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
const lum = (hex) => {
  const [r, g, b] = toRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** Darken until the color reads as text on white (cards print it on white and on light tints). */
function readable(hex, min = 3.6) {
  let c = hex;
  for (let i = 0; i < 20 && contrast(c, "#FFFFFF") < min; i++) c = mix(c, "#000000", 0.08);
  return c;
}
const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** The logo's main colors, most prominent first: `[{ hex, hue, sat, light, share }]`. */
function logoColors(dataUrl) {
  const S = 64;
  const href = dataUrl.replace(/"/g, "%22");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${S}" height="${S}"><image width="${S}" height="${S}" preserveAspectRatio="xMidYMid meet" href="${href}" xlink:href="${href}"/></svg>`;
  const px = new Resvg(svg, { fitTo: { mode: "width", value: S } }).render().pixels;
  const buckets = new Map();
  let total = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    total++;
    const key = (px[i] >> 4) * 256 + (px[i + 1] >> 4) * 16 + (px[i + 2] >> 4);
    const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += px[i]; b.g += px[i + 1]; b.b += px[i + 2];
    buckets.set(key, b);
  }
  if (!total) return [];
  // Merge buckets of nearly the same color, biggest first, so anti-aliased edges don't count as colors of their own.
  const groups = [];
  for (const b of [...buckets.values()].sort((x, y) => y.n - x.n)) {
    const rgb = [b.r / b.n, b.g / b.n, b.b / b.n];
    const g = groups.find((x) => Math.hypot(...x.rgb.map((v, i) => v - rgb[i])) < 48);
    if (g) {
      g.rgb = g.rgb.map((v, i) => (v * g.n + rgb[i] * b.n) / (g.n + b.n));
      g.n += b.n;
    } else groups.push({ rgb, n: b.n });
  }
  return groups.sort((x, y) => y.n - x.n).map((g) => {
    const [hue, sat, light] = hsl(g.rgb);
    return { hex: toHex(g.rgb), hue, sat, light, share: g.n / total };
  });
}

/** `{ primary, secondary }` from a logo, or null when it has no usable color. */
export function colorsFromLogo(dataUrl) {
  let colors;
  try {
    colors = logoColors(dataUrl);
  } catch (e) {
    console.error("[brand] couldn't read the logo", e.message);
    return null;
  }
  const big = colors.filter((c) => c.share >= 0.02);
  const vivid = big.filter((c) => c.sat >= 0.28 && c.light > 0.12 && c.light < 0.88);
  const dark = big.find((c) => c.light <= 0.3);
  let primary = vivid[0] || dark;
  if (!primary) return null; // a blank or all-white picture
  const second = vivid.find((c) => c !== primary && hueGap(c.hue, primary.hue) >= 28) || (dark && dark !== primary ? dark : null);
  return { primary: primary.hex, secondary: second ? second.hex : null };
}

/** Every token the cards use, built from a brand's primary (and optional secondary) color. */
export function themeFrom({ primary, secondary }, logo = "", logoAspect = 1) {
  const p = readable(primary);
  const s = secondary ? readable(secondary) : readable(mix(primary, "#000000", 0.45));
  const ink = mix(p, "#12141C", 0.88);
  const nightBg = mix(p, "#0B0D16", 0.84);
  return {
    ...DEFAULT_THEME, logo, logoAspect,
    ink, muted: mix(ink, "#FFFFFF", 0.42),
    green: p, greenBg: mix(p, "#FFFFFF", 0.89), red: s, redBg: mix(s, "#FFFFFF", 0.9),
    stripe: [p, "#FFFFFF", s], onInk: mix(p, "#FFFFFF", 0.55), onInkSoft: mix(ink, "#FFFFFF", 0.78),
    ring: mix(p, "#FFFFFF", 0.25), ringSoft: mix(p, "#FFFFFF", 0.8), ring2: mix(ink, "#FFFFFF", 0.35), ring2Soft: mix(ink, "#FFFFFF", 0.83),
    night: { bg: nightBg, bg2: mix(nightBg, "#FFFFFF", 0.05), line: mix(nightBg, "#FFFFFF", 0.17), soft: mix(nightBg, "#FFFFFF", 0.65), face: mix(nightBg, "#FFFFFF", 0.5) },
  };
}

const cache = new Map(); // logo → colors, so a logo is only read once

/**
 * The workspace's company logo and the colors read from it. Fully automatic: nothing is picked by hand.
 * Only the company logo (`ws.brand.logo`, Settings → Workspace) counts; the bot's picture is just its Discord avatar.
 */
export function brandInfo(ws = {}) {
  const b = ws.brand || {};
  const logo = typeof b.logo === "string" && /^data:image\/(png|jpeg);base64,/.test(b.logo) ? b.logo : "";
  // Width ÷ height, so wide and tall logos keep their shape on the cards.
  const logoAspect = logo && b.w > 0 && b.h > 0 ? Math.min(4, Math.max(0.5, b.w / b.h)) : 1;
  if (logo && !cache.has(logo)) {
    if (cache.size > 200) cache.clear();
    cache.set(logo, colorsFromLogo(logo));
  }
  const detected = (logo && cache.get(logo)) || null;
  return { logo, logoAspect, detected, source: detected ? "logo" : logo ? "no_colors" : "no_logo" };
}

/** The theme for a workspace document: the company logo's colors, or the default palette when there is no usable logo. */
export function brandTheme(ws = {}) {
  const { logo, logoAspect, detected } = brandInfo(ws);
  return detected ? themeFrom(detected, logo, logoAspect) : { ...DEFAULT_THEME, logo, logoAspect };
}
