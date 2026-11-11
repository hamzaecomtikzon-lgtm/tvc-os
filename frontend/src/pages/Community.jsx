import { useEffect, useMemo, useState } from "react";
import { useApp } from "../context/app.js";
import { db } from "../services/db.js";
import { callCached } from "../services/cruva.js";
import { COMM_TABS } from "../lib/constants.js";
import { change, fmtDate, fmtSecs, int, pct, rangeLabel } from "../lib/format.js";
import { STAT_KEYS, cohorts, commMetrics } from "../lib/community.js";
import { Callout, Chg, Empty, Err, Hero, Kpi, Skel } from "../components/ui.jsx";
import LineChart from "../components/LineChart.jsx";
import Scoring from "./Scoring.jsx";

/* ---------- data ---------- */
async function loadCommunity(shopId, gid, from, to) {
  const out = { members: [], header: {}, activity: [], videos: [], err: null };
  try {
    let page = 1, more = true;
    while (more && page <= 5) {
      const r = await callCached("listDiscordMembers", { shop_id: shopId, page, page_size: 100 });
      if (page === 1) out.header = r.header;
      out.members.push(...r.members);
      more = r.more;
      page++;
    }
  } catch (e) {
    out.err = e;
  }
  if (gid) out.activity = db.list("activity", (d) => d.guild === gid);
  try {
    out.videos = (await callCached("searchVideos", { shop_id: shopId, date_from: from, date_to: to, sort_by: "gmv", sort_direction: "desc", page_size: 100 })).videos;
  } catch { /* revenue tab shows zero GMV */ }
  return out;
}

function useCommunity() {
  const { shop, range, gid, refreshKey } = useApp();
  const key = [shop.id, gid, range.from, range.to, refreshKey].join("|");
  const [st, setSt] = useState({ key: null, D: null });
  useEffect(() => {
    let live = true;
    loadCommunity(shop.id, gid, range.from, range.to).then((D) => live && setSt({ key, D }));
    return () => { live = false; };
  }, [key, shop.id, gid, range.from, range.to]);
  return st.key === key ? st.D : null;
}

/* ---------- page ---------- */
export default function Community() {
  const { range, scoring } = useApp();
  const [tab, setTab] = useState("overview");
  const D = useCommunity();
  const M = useMemo(() => (D ? commMetrics(D, scoring, range.from, range.to) : null), [D, scoring, range.from, range.to]);

  let body;
  if (tab === "scoring") body = <Scoring />;
  else if (!D) body = <div className="card"><Skel n={8} /></div>;
  else if (D.err && !D.members.length) body = <Err error={D.err} />;
  else {
    const Tab = { overview: CommOverview, leaderboard: Leaderboard, channels: Channels, revenue: Revenue, retention: Retention }[tab];
    body = <>{!D.activity.length && <NoActivity />}<Tab D={D} M={M} /></>;
  }

  return (
    <>
      <Hero eyebrow={rangeLabel(range.from, range.to)} title="Community" />
      <div className="subnav" role="tablist">
        {COMM_TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {body}
    </>
  );
}

function NoActivity() {
  return (
    <Callout>
      <b>Activity not synced yet.</b> Member data is live; message stats appear after the bot syncs your server (Bot &amp; channels → Re-sync From Discord).
    </Callout>
  );
}

/* ---------- overview ---------- */
function CommOverview({ D, M }) {
  const H = D.header;
  const c = change(M.cur.size, M.prev.size);
  const byScore = M.board.slice().sort((a, b) => b.score - a.score);
  const byMsgs = M.board.slice().sort((a, b) => b.m - a.m).filter((u) => u.m > 0);
  return (
    <>
      <section className="kpis">
        <Kpi label="Active members" tip="Members who posted, reacted or joined voice at least once in the range. Excluded roles don’t count."
          value={int(M.cur.size)} chg={<Chg {...c} />} sub={`${int(H.members)} members · ${int(H.linked)} linked`} />
        <Kpi label="DAU / WAU / MAU" tip="Daily, weekly and monthly active members, measured at the end of the range."
          value={`${M.dau} / ${M.wau} / ${M.mau}`} sub={"Avg DAU " + (M.avgDau || 0).toFixed(1)} />
        <Kpi label="Stickiness" tip="Average daily actives divided by monthly actives. Above 20% is a community people come back to."
          value={M.stick == null ? "—" : pct(M.stick)} sub={M.stick == null ? "No activity yet" : M.stick >= 20 ? "Healthy (above 20%)" : "Below the 20% benchmark"} />
        <Kpi label="Activation" tip="New members active within 7 days of joining. Only joiners who have had the full 7 days count."
          value={M.eligible.length ? pct((M.activated / M.eligible.length) * 100) : "—"} sub={`${M.activated} of ${M.eligible.length} new members`} />
        <Kpi label="New members" tip="Discord members whose join date falls in the range (from Cruva)." value={int(M.joiners.length)} sub="Joined the server in range" />
        <Kpi label="New active" tip="Active this period but not in the previous period of the same length." value={int(M.newActive)} sub={`${M.stayed} stayed active from last period`} />
        <Kpi label="Went quiet" tip="Active in the previous period of the same length, silent in this one." value={int(M.quiet.length)} sub={`of ${M.prev.size} active last period`} />
        <Kpi label="Median reply time" tip="Time from a message to the first reply by someone else."
          value={fmtSecs(M.med)} sub={M.nReplies ? `p90 ${fmtSecs(M.p90)} · ${M.nReplies} replies` : "No replies yet"} />
        <Kpi label="Linked creators" tip="Members whose Discord is linked to a TikTok handle in Cruva."
          value={`${int(H.linked)} / ${int(H.members)}`} sub={H.synced ? "Member list synced " + fmtDate(H.synced) : ""} />
      </section>

      <div className="grid">
        <section className="card"><div className="head"><h2>Top 10 by overall score</h2></div><TopList list={byScore} val={(u) => u.score.toFixed(1)} /></section>
        <section className="card"><div className="head"><h2>Top 10 by messages</h2><span className="muted">Daily cap applied</span></div><TopList list={byMsgs} val={(u) => int(u.m)} /></section>
        <section className="card span">
          <div className="head">
            <h2>Daily activity</h2>
            <div className="legend"><span><i style={{ background: "var(--s1)" }} />Active members</span><span><i style={{ background: "var(--s2)" }} />Messages</span></div>
          </div>
          {M.daily.some((d) => d.active || d.msgs) ? (
            <LineChart
              series={[
                { name: "Active members", color: "var(--s1)", pts: M.daily.map((d) => ({ date: d.date, v: d.active })), area: true },
                { name: "Messages", color: "var(--s2)", pts: M.daily.map((d) => ({ date: d.date, v: d.msgs })) },
              ]}
              axisFmt={int} tipFmt={int} />
          ) : <Empty title="No activity yet" />}
        </section>
        <section className="card span">
          <div className="head"><h2>New members in range</h2><span className="muted">From Cruva · {M.joiners.length} joined</span></div>
          <MemberTable list={M.joiners.slice(0, 25)} M={M} />
        </section>
      </div>
    </>
  );
}

function TopList({ list, val }) {
  if (!list.length) return <Empty>Nothing yet.</Empty>;
  return (
    <div className="rows">
      {list.slice(0, 10).map((u, i) => (
        <div key={u.id}>
          <span className={"rank" + (i ? "" : " first")}>{i + 1}</span>
          <span className="grow trunc" style={{ fontWeight: 600 }}>{u.name}</span>
          <span className="num">{val(u)}</span>
        </div>
      ))}
    </div>
  );
}

const LinkPill = ({ m }) => (m && m.linked ? <span className="pill good">@{m.tiktok}</span> : <span className="pill line">Not linked</span>);

function MemberTable({ list, M }) {
  if (!list.length) return <Empty>No one joined in this range.</Empty>;
  return (
    <div className="tablebox">
      <table>
        <thead><tr><th>Discord member</th><th>TikTok</th><th>Joined</th><th>First 7 days</th></tr></thead>
        <tbody>
          {list.map((m) => {
            const inWindow = !M.eligible.includes(m);
            const act = M.activatedIn(m);
            return (
              <tr key={m.id}>
                <td><b>@{m.user}</b><span className="muted trunc">{m.display}</span></td>
                <td><LinkPill m={m} /></td>
                <td>{fmtDate(m.joined)}</td>
                <td>{inWindow ? <span className="pill line">Still in window</span> : act ? <span className="pill good">Activated</span> : <span className="pill">Silent</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- leaderboard ---------- */
const LB_COLS = [["score", "Overall"], ["m", "Messages"], ["rr", "Reactions received"], ["pr", "Replies received"], ["ad", "Active days"], ["rg", "Reactions given"], ["v", "Voice minutes"]];

function Leaderboard({ M }) {
  const [sort, setSort] = useState("score");
  const rows = M.board.slice().sort((a, b) => (b[sort] || 0) - (a[sort] || 0));
  return (
    <section className="card">
      <div className="head"><h2>Every stat in one place</h2><span className="muted">Hover a score to see how it adds up</span></div>
      {!rows.length ? <Empty title="No scores yet" /> : (
        <div className="tablebox">
          <table>
            <thead>
              <tr>
                <th>#</th><th>Member</th>
                {LB_COLS.map(([k, l]) => (
                  <th key={k} className="r"><button onClick={() => setSort(k)} aria-sort={sort === k ? "descending" : undefined}>{l}{sort === k ? " ↓" : ""}</button></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((u, i) => (
                <tr key={u.id}>
                  <td>{i + 1}</td>
                  <td><b>{u.name}</b> <LinkPill m={M.memberById[u.id]} /></td>
                  <td className="r num" title={STAT_KEYS.map((s) => `${s}: +${u.parts[s].toFixed(1)}`).join("  ")}>{u.score.toFixed(1)}</td>
                  <td className="r">{int(u.m)}</td>
                  <td className="r">{int(u.rr)}</td>
                  <td className="r">{int(u.pr)}</td>
                  <td className="r">{int(u.ad)}</td>
                  <td className="r">{int(u.rg)}</td>
                  <td className="r">{int(u.v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ---------- channels ---------- */
function Channels({ M }) {
  const { channels } = useApp();
  const all = new Map();
  channels.forEach((c) => all.set(c.name, { name: c.name, m: 0, r: 0, p: 0, members: new Set(), last: "", top: {} }));
  Object.values(M.chans).forEach((c) => all.set(c.name, c));
  const list = [...all.values()].sort((a, b) => b.m - a.m || a.name.localeCompare(b.name));
  return (
    <section className="card">
      <div className="head"><h2>Activity per channel</h2><span className="muted">{list.length} channels · Quiet = no messages in the range</span></div>
      {!list.length ? <Empty title="No channels yet">Finish the setup guide first.</Empty> : (
        <div className="tablebox">
          <table>
            <thead><tr><th>Channel</th><th className="r">Messages</th><th className="r">Members</th><th className="r">Reactions</th><th className="r">Replies</th><th>Top members</th><th>Last message</th></tr></thead>
            <tbody>
              {list.map((c) => {
                const top = Object.entries(c.top).sort((a, b) => b[1] - a[1]).slice(0, 3);
                return (
                  <tr key={c.name}>
                    <td><b>#{c.name}</b> {!c.m && <span className="pill">Quiet</span>}</td>
                    <td className="r">{int(c.m)}</td>
                    <td className="r">{int(c.members.size)}</td>
                    <td className="r">{int(c.r)}</td>
                    <td className="r">{int(c.p)}</td>
                    <td>{top.length ? <span className="checks">{top.map(([u, n]) => <span key={u} className="pill line">{M.names[u] || u} · {n}</span>)}</span> : "—"}</td>
                    <td>{c.last ? fmtDate(c.last) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ---------- creators × revenue ---------- */
function Revenue({ D, M }) {
  const { money } = useApp();
  const gmv = {};
  D.videos.forEach((x) => {
    const g = gmv[x.handle] || (gmv[x.handle] = { g: 0, n: 0, views: 0 });
    g.g += x.gmv || 0; g.n++; g.views += x.views || 0;
  });
  const linked = D.members.filter((m) => m.linked && m.tiktok);
  const rows = linked.map((m) => {
    const b = M.board.find((u) => u.id === m.id);
    const days = b ? b.ad : 0;
    const g = gmv[m.tiktok] || { g: 0, n: 0, views: 0 };
    return { m, days, engaged: days >= 3, gmv: g.g, posts: g.n, views: g.views };
  }).sort((a, b) => b.gmv - a.gmv);
  const eng = rows.filter((r) => r.engaged), not = rows.filter((r) => !r.engaged);
  const avg = (arr, k) => (arr.length ? arr.reduce((s, r) => s + r[k], 0) / arr.length : null);
  const lift = (k) => {
    const a = avg(eng, k), b = avg(not, k);
    return a != null && b ? (a / b).toFixed(1) + "x" : "—";
  };
  return (
    <>
      <section className="kpis">
        <Kpi label="Sales lift" tip="How much more engaged creators (active 3+ days) sell than linked creators who aren’t engaged." value={lift("gmv")} sub="Engaged vs not engaged, avg video GMV" />
        <Kpi label="Engaged creators" tip="Linked creators active on 3 or more days in the range." value={int(eng.length)} sub="Linked, active 3+ days" />
        <Kpi label="Not engaged" tip="Linked creators active on fewer than 3 days." value={int(not.length)} sub="Linked, under 3 active days" />
        <Kpi label="Posts lift" tip="How many more selling videos engaged creators have." value={lift("posts")} sub="Selling videos, engaged vs not" />
      </section>
      <section className="card">
        <div className="head"><h2>Linked creators</h2><span className="muted">{linked.length} linked · GMV from their top videos in range</span></div>
        {!rows.length ? <Empty title="No linked creators yet" /> : (
          <div className="tablebox">
            <table>
              <thead><tr><th>Creator</th><th>Engagement</th><th className="r">Active days</th><th className="r">Video GMV</th><th className="r">Selling videos</th><th className="r">Views</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.m.id}>
                    <td><b>@{r.m.tiktok}</b><span className="muted trunc">{r.m.user} on Discord</span></td>
                    <td><span className={"pill " + (r.engaged ? "good" : "line")}>{r.engaged ? "Engaged" : "Not engaged"}</span></td>
                    <td className="r">{r.days}</td>
                    <td className="r num">{money(r.gmv)}</td>
                    <td className="r">{r.posts}</td>
                    <td className="r">{int(r.views)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/* ---------- retention ---------- */
function Retention({ D, M }) {
  const rows = cohorts(D.members, M.activeIn);
  return (
    <section className="card">
      <div className="head"><h2>Retention by join week</h2><span className="muted">% active after 1, 2, 4, 8 weeks</span></div>
      {!rows.length ? <Empty title="No join dates yet" /> : (
        <div className="tablebox">
          <table className="coh">
            <thead><tr><th style={{ textAlign: "left" }}>Joined week of</th><th>Members</th><th>Week 1</th><th>Week 2</th><th>Week 4</th><th>Week 8</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.wk}>
                  <td style={{ textAlign: "left" }}><b>{fmtDate(c.wk)}</b></td>
                  <td>{c.n}</td>
                  {c.c.map((p, i) => p == null ? <td key={i} /> : <td key={i} className="h" style={{ "--p": Math.round(p * 0.6) }}>{Math.round(p)}%</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
