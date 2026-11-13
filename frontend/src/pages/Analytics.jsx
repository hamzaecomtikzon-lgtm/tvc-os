import { useState } from "react";
import { useApp } from "../context/app.js";
import { useCruva } from "../hooks/useCruva.js";
import { useCommunity, useCreators } from "../hooks/useCommunity.js";
import { cohorts } from "../lib/community.js";
import { COMM_TABS, defaultScoring } from "../lib/constants.js";
import { downloadCsv, fmtDate, fmtSecs, initials, int, pct } from "../lib/format.js";
import { Chg, DateRange, Empty, Ico, KBox, LineChart, PageHead, Skel, Tabs } from "../components/ui.jsx";

const micro = { fontSize: "var(--text-micro)" };
const STAT_COLS = [["m", "Messages"], ["rr", "Reactions received"], ["pr", "Replies received"], ["ad", "Active days"], ["rg", "Reactions given"], ["v", "Voice minutes"]];

export default function Analytics() {
  const { view, setView, crmName, range, money, shop, toast } = useApp();
  const tab = view.an || "community";
  const creators = useCreators();
  const overall = useCruva("getShopStats", { shop_id: shop?.id, date_from: range.from, date_to: range.to, stats: OVERALL, include_charts: true }, !!shop && tab === "overall");

  const exportCsv = () => {
    const name = `kreo-${tab}-${range.from}-to-${range.to}.csv`;
    if (tab === "community") {
      downloadCsv(name, [["TikTok", "Name", "Email", "Phone", "WhatsApp", "Discord", "GMV", "Sales", "Videos", "Messages", "Joined"],
        ...creators.rows.map((c) => [c.handle, c.name, c.email, c.phone, c.wa, c.member?.user || "", c.gmv, c.sales, c.videos, c.msgs, c.joined])]);
    } else if (overall.data) {
      const d = overall.data;
      downloadCsv(name, [["Date", ...OVERALL.map((k) => d[k].label)], ...d.total_gmv.series.map((p, i) => [p.date, ...OVERALL.map((k) => d[k].series[i]?.v ?? "")])]);
    } else return toast("Nothing to export yet.");
    toast("Exported " + name);
  };

  return (
    <>
      <PageHead title="Analytics" desc={tab === "community" ? "Creators in your Discord community and what they’re doing there." : `Everything in ${crmName}: your whole TikTok Shop creator program. Sample data until a live CRM connection exists.`}>
        <DateRange /><button className="btn" type="button" onClick={exportCsv}><Ico name="download" />Export</button>
      </PageHead>
      <Tabs value={tab} onChange={(an) => setView({ an })} tabs={[["community", <><Ico name="users" />Community analytics</>], ["overall", <><Ico name="chart" />Overall (CRM)</>]]} />
      {tab === "community" ? <Community creators={creators} /> : <Overall stats={overall} creators={creators} money={money} />}
    </>
  );
}

/* ---------- community ---------- */
function Community({ creators }) {
  const { view, setView, conn } = useApp();
  const ct = view.ct || "overview";
  const C = useCommunity();
  return (
    <>
      <div className="seg" role="tablist" style={{ marginBottom: 16 }}>
        {COMM_TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={ct === k} className={ct === k ? "on" : ""} onClick={() => setView({ ct: k })}>{l}</button>)}
      </div>
      {!C.listed && ct !== "scoring" && <div className="hint warn" style={{ marginBottom: 14 }}><Ico name="shield" /><div>Discord isn’t letting the bot list your members. In the Discord Developer Portal, open your bot → Bot → turn on <b>Server Members Intent</b>, then restart the backend and press Refresh in Settings → Bot &amp; server.</div></div>}
      {C.listed && conn.gateway.connected === false && ct !== "scoring" && <div className="hint" style={{ marginBottom: 14 }}><Ico name="plug" /><div>The bot isn’t connected to Discord right now, so new activity isn’t being counted.</div></div>}
      {ct === "overview" && <Overview C={C} />}
      {ct === "creators" && <Creators {...creators} />}
      {ct === "leaderboard" && <Leaderboard C={C} />}
      {ct === "channels" && <Channels C={C} />}
      {ct === "revenue" && <Revenue C={C} rows={creators.rows} />}
      {ct === "retention" && <Retention C={C} />}
      {ct === "scoring" && <Scoring />}
    </>
  );
}

function MemberRow({ u, i, m, value }) {
  return (
    <div className="lrow">
      <span style={{ display: "flex", gap: 8, alignItems: "center" }}><span className="rk">{i + 1}</span><span className={"cav" + (i === 0 ? " r" : "")}>{initials(u.name)}</span></span>
      <div style={{ minWidth: 0 }}><b>{u.name}</b><span className="sub">{m?.tiktok ? "@" + m.tiktok : "Not linked"}</span></div>
      <span className="num">{value}</span>
    </div>
  );
}

function Overview({ C }) {
  const { setView, crmName, openCreator } = useApp();
  const { M, members, byId, tracking } = C;
  const linked = members.filter((m) => m.linked).length;
  const today = new Date().toISOString().slice(0, 10);
  const daysIn = (m) => Math.round((Date.parse(today) - Date.parse(m.joined)) / 864e5);
  return (
    <>
      <div className="kpis6">
        <KBox label="Active members" value={int(M.cur.size)} sub={`${int(members.length)} members · ${int(linked)} linked`} tip="Members who posted, reacted or joined voice at least once in the range. Excluded roles don’t count." chip={<Chg now={M.cur.size} prev={M.prev.size} />} />
        <KBox label="DAU / WAU / MAU" value={`${int(M.dau)} / ${int(M.wau)} / ${int(M.mau)}`} sub={"Avg DAU " + M.avgDau.toFixed(1)} tip="Daily, weekly and monthly active members, measured at the end of the range." />
        <KBox label="Stickiness" value={pct(M.stick)} sub={M.stick == null ? "No activity yet" : M.stick >= 20 ? "Healthy (above 20%)" : "Below the 20% benchmark"} tip="Average daily actives divided by monthly actives. Above 20% is a community people come back to." />
        <KBox label="Activation" value={M.eligible.length ? pct((M.activated / M.eligible.length) * 100) : "—"} sub={`${M.activated} of ${M.eligible.length} new members`} tip="New members active within 7 days of joining. Only joiners who have had the full 7 days count." />
        <KBox label="New members" value={int(M.joiners.length)} sub="Joined the server in range" tip="Discord members whose join date falls in the range." />
        <KBox label="New active" value={int(M.newActive)} sub={`${int(M.stayed)} stayed active from last period`} tip="Active this period but not in the previous period of the same length." />
        <KBox label="Went quiet" value={int(M.quiet.length)} sub={`of ${int(M.prev.size)} active last period`} tip="Active in the previous period of the same length, silent in this one." />
        <KBox label="Median reply time" value={fmtSecs(M.med)} sub={`p90 ${fmtSecs(M.p90)} · ${int(M.nReplies)} replies`} tip="Time from a message to the first reply by someone else." />
        <KBox label="Linked creators" value={`${int(linked)} / ${int(members.length)}`} sub={"Gave a TikTok handle in onboarding"} tip={`Members whose Discord is linked to a TikTok handle, which is how they’re matched to creators in ${crmName}.`} />
      </div>
      {!tracking && <div className="hint" style={{ marginBottom: 14 }}><Ico name="eye" /><div>No activity counted yet. The bot counts messages, reactions and voice time from the moment it’s connected; anything said before that isn’t included.</div></div>}
      <div className="bento">
        <section className="tile s6">
          <div className="th"><h2>Top 10 by overall score</h2><div className="r"><button className="btn sm ghost" type="button" onClick={() => setView({ ct: "leaderboard" })}>Leaderboard <Ico name="arrow" /></button></div></div>
          {M.board.length ? [...M.board].sort((a, b) => b.score - a.score).slice(0, 10).map((u, i) => <MemberRow key={u.id} u={u} i={i} m={byId[u.id]} value={u.score.toFixed(1)} />) : <Empty>No activity yet.</Empty>}
        </section>
        <section className="tile s6">
          <div className="th"><h2>Top 10 by messages</h2><span className="muted" style={micro}>Daily cap applied</span></div>
          {M.board.some((u) => u.m > 0) ? M.board.filter((u) => u.m > 0).sort((a, b) => b.m - a.m).slice(0, 10).map((u, i) => <MemberRow key={u.id} u={u} i={i} m={byId[u.id]} value={int(u.m)} />) : <Empty>No messages yet.</Empty>}
        </section>
        <section className="tile s12">
          <div className="th"><h2>Daily activity</h2><div className="r legend"><span><i style={{ background: "var(--color-primary)" }} />Active members</span><span><i style={{ background: "var(--color-accent)" }} />Messages</span></div></div>
          <LineChart data={M.daily} keys={[{ k: "active", c: "var(--color-primary)" }, { k: "msgs", c: "var(--color-accent)" }]} h={200} />
        </section>
        <section className="tile s12">
          <div className="th"><h2>New members in range</h2><span className="muted" style={micro}>{int(M.joiners.length)} joined</span></div>
          {M.joiners.length ? (
            <div className="tblwrap"><table className="tbl" style={{ minWidth: 560 }}>
              <thead><tr><th>Discord member</th><th>TikTok</th><th>Joined</th><th>First 7 days</th></tr></thead>
              <tbody>{M.joiners.map((m) => (
                <tr key={m.id} onClick={() => openCreator(m.tiktok ? "c:" + m.tiktok : "m:" + m.id)}>
                  <td><div className="who"><span className="cav">{initials(m.name)}</span><div><b>@{m.user}</b><span>{m.name}</span></div></div></td>
                  <td>{m.linked ? <span className="pill good">@{m.tiktok}</span> : <span className="pill line">Not linked</span>}</td>
                  <td className="muted">{fmtDate(m.joined)}</td>
                  <td>{daysIn(m) < 7 ? <span className="pill line">Still in window</span> : M.activatedIn(m) ? <span className="pill good">Activated</span> : <span className="pill rose">Silent</span>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <Empty title="No one joined in this range">Pick a longer range to see new members.</Empty>}
        </section>
      </div>
    </>
  );
}

function Leaderboard({ C }) {
  const { scoring, openCreator } = useApp();
  const [sort, setSort] = useState("score");
  const rows = [...C.M.board].sort((a, b) => (b[sort] || 0) - (a[sort] || 0));
  return (
    <>
      <div className="th"><h2>Every stat in one place</h2><span className="muted" style={micro}>Click a column to sort. Hover a score for its breakdown.{scoring.excludedRoles.length ? ` Excluded roles: ${scoring.excludedRoles.join(", ")}.` : ""}</span></div>
      <div className="tblwrap"><table className="tbl">
        <thead><tr><th>#</th><th>Member</th>{[["score", "Overall"], ...STAT_COLS].map(([k, l]) => <th key={k} className="r"><button type="button" aria-sort={sort === k ? "descending" : undefined} onClick={() => setSort(k)}>{l}{sort === k ? " ↓" : ""}</button></th>)}</tr></thead>
        <tbody>
          {rows.map((u, i) => {
            const m = C.byId[u.id];
            return (
              <tr key={u.id} onClick={() => m && openCreator(m.tiktok ? "c:" + m.tiktok : "m:" + m.id)}>
                <td className="muted mono">{i + 1}</td>
                <td><div className="who"><span className="cav">{initials(u.name)}</span><div><b>{u.name}</b><span>{m?.tiktok ? "@" + m.tiktok : "Not linked"}{m?.roles?.length ? " · " + m.roles.join(", ") : ""}</span></div></div></td>
                <td className="r num" title={STAT_COLS.map(([k, l]) => `${l}: +${u.parts[k].toFixed(1)}`).join("\n")}>{u.score.toFixed(1)}</td>
                {STAT_COLS.map(([k]) => <td key={k} className="r num">{int(u[k])}</td>)}
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={9}><Empty title="No activity in this range">Members appear here once they post or react.</Empty></td></tr>}
        </tbody>
      </table></div>
    </>
  );
}

function Channels({ C }) {
  const { channels, scoring } = useApp();
  const ex = new Set(scoring.excludedChannels);
  const list = channels.filter((c) => !ex.has(c.name)).map((c) => {
    const s = C.M.chans[c.name];
    return {
      name: c.name, m: s?.m || 0, members: s?.members.size || 0, r: s?.r || 0, p: s?.p || 0, last: s?.last || "",
      top: s ? Object.entries(s.top).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, n]) => [C.M.names[id] || C.byId[id]?.name || "member", n]) : [],
    };
  }).sort((a, b) => b.m - a.m || a.name.localeCompare(b.name));
  return (
    <>
      <div className="th"><h2>Activity per channel</h2><span className="muted" style={micro}>{list.length} channels · Quiet = no messages in the range{ex.size ? ` · ${ex.size} excluded in Scoring settings` : ""}</span></div>
      <div className="tblwrap"><table className="tbl" style={{ minWidth: 900 }}>
        <thead><tr><th>Channel</th><th className="r">Messages</th><th className="r">Members</th><th className="r">Reactions</th><th className="r">Replies</th><th>Top members</th><th>Last message</th></tr></thead>
        <tbody>{list.map((c) => (
          <tr key={c.name} style={{ cursor: "default" }}>
            <td><b style={{ color: "var(--color-heading)", fontWeight: 500 }}>#{c.name}</b> {!c.m && <span className="pill rose">Quiet</span>}</td>
            <td className="r num">{int(c.m)}</td><td className="r num">{int(c.members)}</td><td className="r num">{int(c.r)}</td><td className="r num">{int(c.p)}</td>
            <td>{c.top.length ? c.top.map(([u, n]) => <span key={u} className="pill line" style={{ marginRight: 4 }}>{u} · {n}</span>) : <span className="muted">—</span>}</td>
            <td className="muted">{c.last ? fmtDate(c.last) : "—"}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </>
  );
}

function Revenue({ rows }) {
  const { money, openCreator, crmName } = useApp();
  const linked = rows.filter((r) => r.member && r.inCrm).sort((a, b) => b.gmv - a.gmv);
  const eng = linked.filter((r) => r.engaged), not = linked.filter((r) => !r.engaged);
  const avg = (a, k) => (a.length ? a.reduce((s, r) => s + r[k], 0) / a.length : null);
  const lift = (k) => { const a = avg(eng, k), b = avg(not, k); return a != null && b ? (a / b).toFixed(1) + "x" : "—"; };
  return (
    <>
      <div className="kpis6">
        <KBox label="Sales lift" value={lift("gmv")} sub="Engaged vs not engaged, avg video GMV" tip="How much more engaged creators (active 3+ days) sell than linked creators who aren’t engaged." />
        <KBox label="Engaged creators" value={int(eng.length)} sub="Linked, active 3+ days" tip="Linked creators active on 3 or more days in the range." />
        <KBox label="Not engaged" value={int(not.length)} sub="Linked, under 3 active days" tip="Linked creators active on fewer than 3 days." />
        <KBox label="Posts lift" value={lift("videos")} sub="Videos posted, engaged vs not" tip="How many more videos engaged creators posted." />
      </div>
      <div className="th"><h2>Linked creators</h2><span className="muted" style={micro}>Discord members matched to a {crmName} creator by TikTok handle · GMV from their videos in range</span></div>
      <div className="tblwrap"><table className="tbl" style={{ minWidth: 760 }}>
        <thead><tr><th>Creator</th><th>Engagement</th><th className="r">Active days</th><th className="r">Video GMV</th><th className="r">Videos</th><th className="r">Views</th></tr></thead>
        <tbody>
          {linked.map((r) => (
            <tr key={r.key} onClick={() => openCreator(r.key)}>
              <td><div className="who"><span className="cav">{initials(r.name)}</span><div><b>@{r.handle}</b><span>{r.member.user} on Discord</span></div></div></td>
              <td><span className={"pill " + (r.engaged ? "good" : "line")}>{r.engaged ? "Engaged" : "Not engaged"}</span></td>
              <td className="r num">{r.activeDays}</td><td className="r num">{money(r.gmv, true)}</td><td className="r num">{int(r.videos)}</td><td className="r num">{int(r.views)}</td>
            </tr>
          ))}
          {!linked.length && <tr><td colSpan={6}><Empty title="No linked creators yet">A member is linked when they give their TikTok handle in the onboarding DM and that handle is a creator in {crmName}.</Empty></td></tr>}
        </tbody>
      </table></div>
    </>
  );
}

function Retention({ C }) {
  const rows = cohorts(C.everyone, C.M.activeIn);
  return (
    <>
      <div className="th"><h2>Retention by join week</h2><span className="muted" style={micro}>Share still active 1, 2, 4 and 8 weeks later. Blank = hasn’t happened yet.</span></div>
      <div className="tblwrap"><table className="tbl coh" style={{ minWidth: 560 }}>
        <thead><tr><th>Joined week of</th><th className="r">Members</th><th className="r">Week 1</th><th className="r">Week 2</th><th className="r">Week 4</th><th className="r">Week 8</th></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.wk} style={{ cursor: "default" }}>
              <td><b style={{ color: "var(--color-heading)", fontWeight: 500 }}>{fmtDate(c.wk)}, {c.wk.slice(0, 4)}</b></td><td className="r num">{c.n}</td>
              {c.c.map((p, i) => (p == null ? <td key={i} /> : <td key={i} className="r heat" style={{ "--p": Math.round(p * 0.7) + "%" }}>{Math.round(p)}%</td>))}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={6}><Empty>No members to show yet.</Empty></td></tr>}
        </tbody>
      </table></div>
    </>
  );
}

function Scoring() {
  const { scoring, saveScoring, channels, guild, toast, isAdmin } = useApp();
  const [sc, setSc] = useState(scoring);
  const tog = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const W = [["m", "Messages", "Messages that count: bursts within the cooldown count once, each day is capped."], ["rr", "Reactions received", "Reactions others left on their messages."], ["pr", "Replies received", "Replies from others to their messages."], ["ad", "Active days", "Days they posted at least one message."], ["rg", "Reactions given", "Reactions they added."], ["v", "Voice minutes", "Time in voice channels."]];
  const save = async () => {
    const clean = { ...sc, cap: Math.max(1, parseInt(sc.cap, 10) || 50), cooldown: Math.max(0, parseInt(sc.cooldown, 10) || 0), w: Object.fromEntries(W.map(([k]) => [k, Math.max(0, Math.min(10, parseFloat(sc.w[k]) || 0))])) };
    if (await saveScoring(clean)) { setSc(clean); toast("Scoring saved. Leaderboard and channels updated."); }
  };
  return (
    <section className="card2">
      <div className="h"><h3>How the leaderboard counts</h3><p>The daily cap, excluded roles, excluded channels and weights apply to every range, past ones too. The cooldown applies to messages from now on.</p></div>
      <div className="frow">
        <label className="field">Daily message cap<input className="input" type="number" min="1" value={sc.cap} onChange={(e) => setSc({ ...sc, cap: e.target.value })} /><small>Most messages one member can score per day.</small></label>
        <label className="field">Cooldown (seconds)<input className="input" type="number" min="0" value={sc.cooldown} onChange={(e) => setSc({ ...sc, cooldown: e.target.value })} /><small>Messages closer together count once.</small></label>
      </div>
      <div className="field">Excluded channels<div className="filters" style={{ margin: 0 }}>{channels.map((c) => <button key={c.id} type="button" className={"chip" + (sc.excludedChannels.includes(c.name) ? " on" : "")} onClick={() => setSc({ ...sc, excludedChannels: tog(sc.excludedChannels, c.name) })}>#{c.name}</button>)}</div><small>Left out of the channel table.</small></div>
      <div className="field">Excluded roles<div className="filters" style={{ margin: 0 }}>{(guild?.roles || []).map((r) => <button key={r} type="button" className={"chip" + (sc.excludedRoles.includes(r) ? " on" : "")} onClick={() => setSc({ ...sc, excludedRoles: tog(sc.excludedRoles, r) })}>{r}</button>)}{!guild?.roles?.length && <span className="muted">Your server has no roles yet.</span>}</div><small>Members with these roles never rank.</small></div>
      <div className="frow">{W.map(([k, l, d]) => <label key={k} className="field">{l} weight<input className="input" type="number" step="0.5" min="0" max="10" value={sc.w[k]} onChange={(e) => setSc({ ...sc, w: { ...sc.w, [k]: e.target.value } })} /><small>{d}</small></label>)}</div>
      <div style={{ display: "flex", gap: 8 }}><button className="btn primary" type="button" disabled={!isAdmin} onClick={save}>Save scoring</button><button className="btn ghost" type="button" disabled={!isAdmin} onClick={() => setSc(defaultScoring())}>Reset</button></div>
    </section>
  );
}

/* ---------- creators table ---------- */
const SEGS = {
  all: ["All", () => true],
  selling: ["Selling", (c) => c.gmv > 0],
  "not-posted": ["Not posted yet", (c) => c.inCrm && !c.videos && !c.gmv],
  discord: ["In Discord", (c) => !!c.member],
  silent: ["Quiet in Discord", (c) => c.member && !c.engaged],
  wa: ["Has WhatsApp", (c) => !!c.wa],
  unlinked: ["Not linked", (c) => !c.member || !c.inCrm],
};
const SORTS = { gmv: (c) => -c.gmv, msgs: (c) => -c.msgs, joined: (c) => c.joined || "9", name: (c) => c.handle || c.name };

function Creators({ rows, loading, error }) {
  const { view, setView, money, crmName, openCreator } = useApp();
  const [seg, setSeg] = useState("all");
  const [sort, setSort] = useState("gmv");
  const q = (view.q || "").toLowerCase();
  if (loading) return <div className="tile"><Skel n={6} /></div>;
  if (error) return <div className="tile"><Empty title="Couldn’t load creators">{error.message}</Empty></div>;
  const list = rows.filter(SEGS[seg][1]).filter((c) => !q || [c.handle, c.name, c.email, c.member?.user].join(" ").toLowerCase().includes(q))
    .sort((a, b) => { const x = SORTS[sort](a), y = SORTS[sort](b); return x < y ? -1 : x > y ? 1 : 0; });
  const Th = ({ k, children, r }) => <th className={r ? "r" : ""}><button type="button" onClick={() => setSort(k)}>{children}{sort === k ? " ↓" : ""}</button></th>;
  return (
    <>
      <div className="filters">
        <input className="input" placeholder="Search name, @handle or email" aria-label="Search creators" value={view.q || ""} onChange={(e) => setView({ q: e.target.value })} />
        {Object.entries(SEGS).map(([k, [label, fn]]) => <button key={k} type="button" className={"chip" + (seg === k ? " on" : "")} onClick={() => setSeg(k)}>{label} <small>{rows.filter(fn).length}</small></button>)}
        <span className="muted" style={{ marginLeft: "auto", ...micro }}>Email and phone from {crmName} (sample contacts). WhatsApp from {crmName} or found in DMs.</span>
      </div>
      <div className="tblwrap"><table className="tbl">
        <thead><tr><Th k="name">Creator</Th><th>Contact</th><th>Discord</th><Th k="gmv" r>GMV</Th><th className="r">Sales</th><th className="r">Videos</th><Th k="msgs" r>Messages</Th><Th k="joined">Joined</Th></tr></thead>
        <tbody>
          {list.map((c) => (
            <tr key={c.key} onClick={() => openCreator(c.key)}>
              <td><div className="who"><span className="cav">{initials(c.name || c.handle)}</span><div><b>{c.handle ? "@" + c.handle : c.name}</b><span>{c.handle ? c.name : "No TikTok handle yet"}</span></div></div></td>
              <td><div className="contact">
                {c.email && <div><Ico name="mail" />{c.email} <span className="src">CRM</span></div>}
                {c.phone && <div><Ico name="phone" />{c.phone} <span className="src">CRM</span></div>}
                {c.wa && <div><Ico name="wa" />{c.wa} <span className={"src" + (c.waSrc === "dm" ? " dm" : "")}>{c.waSrc === "dm" ? "From DM" : "CRM"}</span></div>}
                {!c.email && !c.phone && !c.wa && <span className="muted">Not in {crmName}</span>}
              </div></td>
              <td>{c.member ? <><span className="pill good">@{c.member.user}</span><div className="muted" style={{ ...micro, marginTop: 3 }}>{c.engaged ? "Engaged" : "Quiet"}</div></> : <span className="pill line">Not in Discord</span>}</td>
              <td className="r num">{c.gmv ? money(c.gmv, true) : "—"}</td><td className="r num">{int(c.sales)}</td><td className="r num">{int(c.videos)}</td><td className="r num">{c.member ? int(c.msgs) : "—"}</td>
              <td className="muted">{c.joined ? fmtDate(c.joined) : "—"}</td>
            </tr>
          ))}
          {!list.length && <tr><td colSpan={8}><Empty title="No creators match">Try another filter or search.</Empty></td></tr>}
        </tbody>
      </table></div>
    </>
  );
}

/* ---------- overall (CRM) ---------- */
const OVERALL = ["total_gmv", "orders", "affiliate_gmv", "ads_gmv", "videos_posted", "samples_delivered"];

function Overall({ stats, creators, money }) {
  const { shop, range, crmName, openCreator } = useApp();
  const products = useCruva("topProducts", { shop_id: shop?.id, date_from: range.from, date_to: range.to }, !!shop);
  if (stats.loading) return <div className="tile"><Skel n={8} /></div>;
  if (stats.error || !stats.data) return <div className="tile"><Empty title="Couldn’t load CRM data">{stats.error?.message}</Empty></div>;
  const d = stats.data, gmv = d.total_gmv.v || 1, aff = d.affiliate_gmv.v;
  const comm = creators.rows.filter((c) => c.member && c.inCrm).reduce((n, c) => n + c.gmv, 0);
  const chip = (k) => <Chg pct={d[k].pct == null ? null : d[k].dir === "down" ? -d[k].pct : d[k].pct} />;
  const series = d.total_gmv.series.map((p, i) => ({ date: p.date, gmv: p.v, ads: d.ads_gmv.series[i]?.v || 0 }));
  const bar = (label, v, cls) => <div className="bar-r"><div className="t"><span>{label}</span><span>{money(Math.max(0, v), true)}</span></div><div className="track2"><i className={cls} style={{ width: Math.max(0, Math.min(100, (v / gmv) * 100)) + "%" }} /></div></div>;
  return (
    <>
      <div className="kpis6">
        <div className="kp"><div className="l">GMV {chip("total_gmv")}</div><div className="v">{money(d.total_gmv.v, true)}</div></div>
        <div className="kp"><div className="l">Orders {chip("orders")}</div><div className="v">{int(d.orders.v)}</div></div>
        <div className="kp"><div className="l">Affiliate GMV {chip("affiliate_gmv")}</div><div className="v">{money(aff, true)}</div></div>
        <div className="kp"><div className="l">Videos posted {chip("videos_posted")}</div><div className="v">{int(d.videos_posted.v)}</div></div>
        <div className="kp"><div className="l">Creators in CRM</div><div className="v">{int(creators.rows.filter((c) => c.inCrm).length)}</div></div>
        <div className="kp"><div className="l">Samples delivered {chip("samples_delivered")}</div><div className="v">{int(d.samples_delivered.v)}</div></div>
      </div>
      <div className="bento">
        <section className="tile s8"><div className="th"><h2>GMV by day</h2><div className="r legend"><span><i style={{ background: "var(--color-primary)" }} />Total</span><span><i style={{ background: "var(--color-accent)" }} />Paid ads</span></div></div><LineChart data={series} keys={[{ k: "gmv", c: "var(--color-primary)" }, { k: "ads", c: "var(--color-accent)" }]} h={210} money={money} /></section>
        <section className="tile s4"><div className="th"><h2>Where GMV came from</h2></div><div className="bars">
          {bar("Community creators", comm)}
          {bar("Creators not in Discord", aff - comm, "b")}
          {bar("Shop’s own page", gmv - aff, "c")}
          <p className="muted" style={micro}>Community creators (linked Discord members) drove {Math.round((comm / gmv) * 100)}% of GMV in this range.</p>
        </div></section>
        <section className="tile s6"><div className="th"><h2>Top creators (all of {crmName})</h2></div>
          {creators.rows.filter((c) => c.gmv > 0).slice(0, 8).map((c, i) => (
            <div key={c.key} className="lrow" style={{ cursor: "pointer" }} onClick={() => openCreator(c.key)}>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}><span className="rk">{i + 1}</span><span className="cav">{initials(c.name)}</span></span>
              <div style={{ minWidth: 0 }}><b>@{c.handle}</b><span className="sub">{c.member ? "In your Discord" : "Not in Discord yet"}</span></div><span className="num">{money(c.gmv, true)}</span>
            </div>
          ))}
        </section>
        <section className="tile s6"><div className="th"><h2>Top products</h2></div>
          {(products.data || []).slice(0, 8).map((p, i) => (
            <div key={p.name} className="lrow"><span className="rk">{i + 1}</span><div style={{ minWidth: 0 }}><b>{p.name}</b><span className="sub">{int(p.orders)} orders from creator videos</span></div><span className="num">{money(p.gmv, true)}</span></div>
          ))}
          {products.loading && <Skel n={4} />}
        </section>
      </div>
    </>
  );
}
