import { addDays, dateList, daysBetween, todayUTC, ymd } from "./format.js";

export const STAT_KEYS = ["m", "rr", "pr", "ad", "rg", "v"];

/**
 * Community health metrics from Discord activity + Cruva members.
 * D = { members, header, activity, videos }, sc = scoring settings.
 */
export function commMetrics(D, sc, from, to) {
  const len = daysBetween(from, to) + 1;
  const pFrom = ymd(addDays(from, -len)), pTo = ymd(addDays(from, -1));
  const exCh = new Set(sc.excludedChannels || []), exRole = new Set(sc.excludedRoles || []);
  const cap = sc.cap || 9999;
  const byDay = {};
  D.activity.forEach((d) => (byDay[d.date] = d));
  const ok = (u) => !(u.roles || []).some((r) => exRole.has(r));

  const activeCache = {};
  const activeOn = (date) => {
    if (activeCache[date]) return activeCache[date];
    const d = byDay[date];
    const s = new Set();
    if (d && d.users) for (const [k, u] of Object.entries(d.users)) if (ok(u) && (u.m || 0) + (u.rg || 0) + (u.v || 0) > 0) s.add(k);
    return (activeCache[date] = s);
  };
  const activeIn = (a, b) => {
    const s = new Set();
    dateList(a, b).forEach((dt) => activeOn(dt).forEach((k) => s.add(k)));
    return s;
  };

  const days = dateList(from, to);
  const cur = activeIn(from, to), prev = activeIn(pFrom, pTo);
  const dau = activeOn(to).size;
  const wau = activeIn(ymd(addDays(to, -6)), to).size;
  const mau = activeIn(ymd(addDays(to, -29)), to).size;
  const avgDau = days.reduce((s, d) => s + activeOn(d).size, 0) / days.length;

  const users = {}, names = {}, chs = {}, replyTimes = [];
  days.forEach((dt) => {
    const d = byDay[dt];
    if (!d) return;
    Object.entries(d.users || {}).forEach(([k, u]) => {
      if (!ok(u)) return;
      names[k] = u.n || names[k] || k;
      const t = users[k] || (users[k] = { m: 0, rr: 0, pr: 0, ad: 0, rg: 0, v: 0 });
      t.m += Math.min(u.m || 0, cap);
      t.rr += u.rr || 0; t.pr += u.pr || 0; t.rg += u.rg || 0; t.v += u.v || 0;
      if ((u.m || 0) > 0) t.ad += 1;
    });
    Object.values(d.channels || {}).forEach((c) => {
      if (exCh.has(c.name)) return;
      const t = chs[c.name] || (chs[c.name] = { name: c.name, m: 0, r: 0, p: 0, members: new Set(), last: "", top: {} });
      t.m += c.m || 0; t.r += c.r || 0; t.p += c.p || 0;
      Object.entries(c.top || {}).forEach(([u, n]) => { t.members.add(u); t.top[u] = (t.top[u] || 0) + n; });
      if (c.m && dt > t.last) t.last = dt;
    });
    (d.replyTimes || []).forEach((s) => replyTimes.push(s));
  });

  const W = sc.w;
  const lead = {};
  STAT_KEYS.forEach((s) => (lead[s] = Math.max(0, ...Object.values(users).map((u) => u[s]))));
  const wsum = STAT_KEYS.reduce((s, k) => s + (W[k] || 0), 0) || 1;
  const board = Object.entries(users).map(([k, u]) => {
    const parts = {};
    let score = 0;
    STAT_KEYS.forEach((s) => {
      const p = lead[s] > 0 ? (100 * (W[s] || 0) * u[s]) / lead[s] / wsum : 0;
      parts[s] = p;
      score += p;
    });
    return { id: k, name: names[k], ...u, score, parts };
  });

  replyTimes.sort((a, b) => a - b);
  const memberById = {};
  D.members.forEach((m) => { if (m.id) memberById[m.id] = m; });
  const today = ymd(todayUTC());
  const joiners = D.members.filter((m) => m.joined && m.joined >= from && m.joined <= to);
  const eligible = joiners.filter((m) => daysBetween(m.joined, today) >= 7);
  const activatedIn = (m) => activeIn(m.joined, ymd(addDays(m.joined, 6))).has(m.id);
  const activated = eligible.filter(activatedIn).length;
  const daily = days.map((dt) => {
    const d = byDay[dt];
    let mm = 0;
    if (d) Object.values(d.users || {}).forEach((u) => { if (ok(u)) mm += Math.min(u.m || 0, cap); });
    return { date: dt, active: activeOn(dt).size, msgs: mm };
  });

  return {
    cur, prev, dau, wau, mau, avgDau,
    stick: mau ? (avgDau / mau) * 100 : null,
    board,
    med: replyTimes.length ? replyTimes[Math.floor(replyTimes.length / 2)] : null,
    p90: replyTimes.length ? replyTimes[Math.floor(replyTimes.length * 0.9)] : null,
    nReplies: replyTimes.length,
    chans: chs, joiners, eligible, activated, daily, memberById, names, activeIn, activatedIn,
    newActive: [...cur].filter((k) => !prev.has(k)).length,
    stayed: [...cur].filter((k) => prev.has(k)).length,
    quiet: [...prev].filter((k) => !cur.has(k)),
  };
}

/** Weekly join cohorts with % active after 1, 2, 4 and 8 weeks. */
export function cohorts(members, activeIn) {
  const weeks = {};
  members.forEach((m) => {
    if (!m.joined) return;
    const d = new Date(m.joined + "T00:00:00Z");
    const wk = ymd(addDays(d, -((d.getUTCDay() + 6) % 7)));
    (weeks[wk] = weeks[wk] || []).push(m);
  });
  const today = ymd(todayUTC());
  return Object.keys(weeks).sort().reverse().slice(0, 12).map((wk) => {
    const ms = weeks[wk];
    const cell = (n) => {
      const s = ymd(addDays(wk, 7 * n)), e = ymd(addDays(wk, 7 * n + 6));
      if (s > today) return null;
      const act = activeIn(s, e);
      return (ms.filter((m) => act.has(m.id)).length / ms.length) * 100;
    };
    return { wk, n: ms.length, c: [1, 2, 4, 8].map(cell) };
  });
}
