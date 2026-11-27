/** TikTok Shop creator levels: the only ladder the app shows (same as backend/src/levels.js). */
export const LEVELS = [
  { level: 0, badge: "Bronze", range: "$0–$1K", color: "#b0703c" },
  { level: 1, badge: "Silver", range: "Over $1K–$5K", color: "#8a8d93" },
  { level: 2, badge: "Gold", range: "Over $5K–$25K", color: "#c99a06" },
  { level: 3, badge: "Platinum", range: "Over $25K–$60K", color: "#5f8fa3" },
  { level: 4, badge: "Ruby", range: "Over $60K–$150K", color: "#c0264b" },
  { level: 5, badge: "Emerald", range: "Over $150K–$400K", color: "#16935f" },
  { level: 6, badge: "Sapphire", range: "Over $400K–$1.5M", color: "#2456c4" },
  { level: 7, badge: "Diamond", range: "Over $1.5M", color: "#6b4fd8" },
];
export const levelInfo = (l) => LEVELS[l] || null;

/** "L2 · Gold" pill, colored by badge. */
export function LevelPill({ level }) {
  const x = levelInfo(level);
  if (!x) return <span className="muted">—</span>;
  return <span className="lvl" style={{ "--lvl": x.color }} title={`${x.badge}: 30-day GMV ${x.range}`}>L{x.level} · {x.badge}</span>;
}
