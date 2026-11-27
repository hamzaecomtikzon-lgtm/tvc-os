/*
 * TikTok Shop creator levels: the only ladder the app uses (L0–L7), by GMV over the last 30 days.
 *
 *   L0 Bronze    $0–$1,000          L4 Ruby      over $60K–$150K
 *   L1 Silver    over $1K–$5K       L5 Emerald   over $150K–$400K
 *   L2 Gold      over $5K–$25K      L6 Sapphire  over $400K–$1.5M
 *   L3 Platinum  over $25K–$60K     L7 Diamond   over $1.5M
 */
export const LEVELS = [
  { level: 0, badge: "Bronze", over: 0, upTo: 1_000 },
  { level: 1, badge: "Silver", over: 1_000, upTo: 5_000 },
  { level: 2, badge: "Gold", over: 5_000, upTo: 25_000 },
  { level: 3, badge: "Platinum", over: 25_000, upTo: 60_000 },
  { level: 4, badge: "Ruby", over: 60_000, upTo: 150_000 },
  { level: 5, badge: "Emerald", over: 150_000, upTo: 400_000 },
  { level: 6, badge: "Sapphire", over: 400_000, upTo: 1_500_000 },
  { level: 7, badge: "Diamond", over: 1_500_000, upTo: null },
];

/** The level for a 30-day GMV ("over $1K" means more than $1,000), or null when GMV is unknown. */
export function levelOf(gmv30) {
  if (gmv30 == null || Number.isNaN(Number(gmv30))) return null;
  const g = Number(gmv30);
  for (let i = LEVELS.length - 1; i > 0; i--) if (g > LEVELS[i].over) return LEVELS[i].level;
  return 0;
}

/**
 * A creator's level from what the CRM sent: TikTok's level when it's on this ladder (L0–L7),
 * otherwise worked out from their 30-day GMV (UK/EU levels L8–L9, or no level sent).
 */
export function normalizeLevel(level, gmv30) {
  const n = level == null || level === "" ? NaN : Number(level);
  if (Number.isInteger(n) && n >= 0 && n <= 7) return n;
  return levelOf(gmv30);
}
