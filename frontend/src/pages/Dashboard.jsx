import { useApp } from "../context/app.js";
import { useCruva } from "../hooks/useCruva.js";
import { useCommunity, useCreators } from "../hooks/useCommunity.js";
import { AUTOS, WEEKDAYS, daysTimeText, scheduleText, timeText } from "../lib/constants.js";
import { ago, initials, int, rangeText } from "../lib/format.js";
import { Chg, DateRange, Empty, Ico, LineChart, PageHead, Skel, Sw } from "../components/ui.jsx";

const FULL = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
const STATS = ["total_gmv", "affiliate_gmv", "orders"];

/** The next seven days of scheduled posts, soonest first. */
function comingUp(autos, customs) {
  const today = (new Date().getDay() + 6) % 7; // Mon = 0
  const out = [];
  const add = (name, channel, days, time, icon) => (days || []).forEach((d) => {
    const inDays = (WEEKDAYS.indexOf(d) - today + 7) % 7;
    out.push({ name, channel, time, icon, d, day: inDays === 0 ? "Today" : FULL[d], sort: inDays * 10000 + parseInt(String(time).replace(":", ""), 10) });
  });
  AUTOS.forEach((a) => { const s = autos[a.key]; if (s.enabled && s.channel && !a.live) add(a.name, s.channel, s.days, s.time); });
  customs.forEach((c) => { if (c.on) add(c.name, c.channel, c.days, c.time, true); });
  return out.sort((a, b) => a.sort - b.sort).slice(0, 6);
}

export default function Dashboard() {
  const { user, guild, shop, range, money, autos, customs, drafts, dms, botAvatar, crmName, chName, saveAutos, saveCustom, go, openCreator, toast, canEdit } = useApp();
  const stats = useCruva("getShopStats", { shop_id: shop?.id, date_from: range.from, date_to: range.to, stats: STATS, include_charts: true }, !!shop);
  const { rows } = useCreators();
  const { M, members, tracking } = useCommunity();
  const d = stats.data;

  const pending = drafts.filter((x) => x.status === "pending");
  const needs = dms.filter((x) => x.unread || x.status === "needs");
  const todos = [
    ...pending.map((p) => ({ i: "check", t: p.name, s: p.channelName ? "#" + p.channelName : "No channel", tag: "Approve", on: () => go("approvals", { ap: "pending" }) })),
    ...needs.slice(0, 2).map((m) => ({ i: "chat", b: 1, t: "Reply to " + m.name, s: m.msgs[m.msgs.length - 1]?.text.slice(0, 60), tag: "DM", on: () => go("onboarding", { ob: "inbox", dm: m.userId }) })),
    ...(botAvatar ? [] : [{ i: "upload", b: 1, t: "Add a picture for your bot", s: "Posts show a letter until you do", tag: "Setup", on: () => go("workspace", { set: "bot" }) }]),
  ];
  const top = rows.filter((r) => r.gmv > 0).slice(0, 5);
  const series = d ? d.total_gmv.series.map((p, i) => ({ date: p.date, gmv: p.v, aff: d.affiliate_gmv.series[i]?.v || 0 })) : [];
  const on = AUTOS.filter((a) => autos[a.key].enabled).length + customs.filter((c) => c.on).length;
  const next = comingUp(autos, customs);
  const started = dms.filter((t) => t.status !== "closed");
  const hr = new Date().getHours();

  const toggle = async (key, val) => {
    if (await saveAutos({ ...autos, [key]: { ...autos[key], enabled: val } })) toast(`${AUTOS.find((a) => a.key === key).name} ${val ? "turned on" : "paused"}`);
  };
  const mini = (label, k, fmt) => (
    <div className="mini"><div className="l">{label} {d && <Chg pct={d[k].pct == null ? null : d[k].dir === "down" ? -d[k].pct : d[k].pct} />}</div><div className="v">{d ? fmt(d[k].v) : "—"}</div></div>
  );

  return (
    <>
      <PageHead title={`${hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening"}, ${user.name.split(" ")[0]}`} desc={`${guild?.guildName || "No server"} · sales data from ${crmName} (sample data)`}><DateRange /></PageHead>
      <div className="bento">
        <section className="tile s8 link" tabIndex={0} aria-label="Open analytics" onClick={() => go("analytics", { an: "overall" })}>
          <div className="th"><h2>Analytics</h2><span className="muted" style={{ fontSize: "var(--text-micro)" }}>{rangeText(range)}</span><div className="r"><a className="more" href="#analytics">Open analytics <Ico name="arrow" /></a></div></div>
          <div className="minis">
            {mini("GMV", "total_gmv", (v) => money(v, true))}
            {mini("From affiliate creators", "affiliate_gmv", (v) => money(v, true))}
            {mini("Orders", "orders", int)}
          </div>
          <div className="legend"><span><i style={{ background: "var(--color-primary)" }} />Total GMV</span><span><i style={{ background: "var(--color-accent)" }} />Affiliate creators</span></div>
          {stats.loading ? <Skel n={5} /> : stats.error ? <Empty title="Couldn’t load sales data">{stats.error.message}</Empty> : <LineChart data={series} keys={[{ k: "gmv", c: "var(--color-primary)" }, { k: "aff", c: "var(--color-accent)" }]} h={230} money={money} />}
        </section>

        <section className="tile s4">
          <div className="th"><h2>To-do</h2><span className="pill rose">{todos.length}</span><div className="r"><a className="more" href="#approvals">All <Ico name="arrow" /></a></div></div>
          {todos.length ? todos.slice(0, 5).map((t, i) => (
            <div key={i} className="lrow" style={{ cursor: "pointer" }} onClick={t.on}>
              <span className={"todo-i" + (t.b ? " b" : "")}><Ico name={t.i} /></span>
              <div style={{ minWidth: 0 }}><b>{t.t}</b><span className="sub">{t.s}</span></div>
              <span className={"pill" + (t.tag === "Approve" ? " rose" : "")}>{t.tag}</span>
            </div>
          )) : <Empty title="All caught up">New drafts and DMs show up here.</Empty>}
        </section>

        <section className="tile s4">
          <div className="th"><h2>Top creators</h2><span className="muted" style={{ fontSize: "var(--text-micro)" }}>by GMV</span><div className="r"><a className="more" href="#analytics" onClick={(e) => { e.preventDefault(); go("analytics", { an: "community", ct: "creators" }); }}>See all <Ico name="arrow" /></a></div></div>
          {top.length ? top.map((c, i) => (
            <div key={c.key} className="lrow" style={{ cursor: "pointer" }} onClick={() => openCreator(c.key)}>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}><span className="rk">{i + 1}</span><span className={"cav" + (i === 0 ? " r" : "")}>{initials(c.name)}</span></span>
              <div style={{ minWidth: 0 }}><b>@{c.handle}</b><span className="sub">{int(c.sales)} sales{c.member ? " · in Discord" : ""}</span></div>
              <span className="num">{money(c.gmv, true)}</span>
            </div>
          )) : <Empty>No sales in this range.</Empty>}
        </section>

        <section className="tile s4">
          <div className="th"><h2>Automations</h2><span className="pill good">{on} on</span><div className="r"><a className="more" href="#automations">Manage <Ico name="arrow" /></a></div></div>
          {AUTOS.map((a) => (
            <div key={a.key} className="lrow">
              <span className="disc">{a.n}</span>
              <div style={{ minWidth: 0 }}><b>{a.name}</b><span className="sub">{autos[a.key].channel ? "#" + chName(autos[a.key].channel) : "No channel"} · {scheduleText(a, autos[a.key])}</span></div>
              <Sw checked={autos[a.key].enabled} disabled={!canEdit} label={`Turn ${a.name} on or off`} onChange={(v) => toggle(a.key, v)} />
            </div>
          ))}
          {customs.map((c) => (
            <div key={c.id} className="lrow">
              <span className="disc"><Ico name="spark" /></span>
              <div style={{ minWidth: 0 }}><b>{c.name}</b><span className="sub">{c.channel === "dm" ? "Direct message" : "#" + chName(c.channel)} · {daysTimeText(c.days, c.time)}</span></div>
              <Sw checked={c.on} disabled={!canEdit} label={`Turn ${c.name} on or off`} onChange={(v) => { const { id, ...doc } = c; saveCustom(id, { ...doc, on: v }); }} />
            </div>
          ))}
        </section>

        <section className="tile s4">
          <div className="th"><h2>Coming up</h2><span className="muted" style={{ fontSize: "var(--text-micro)" }}>Next 7 days</span></div>
          {next.length ? next.map((r, i) => (
            <div key={i} className="lrow">
              <span className="disc">{r.icon ? <Ico name="spark" /> : r.d}</span>
              <div style={{ minWidth: 0 }}><b>{r.name}</b><span className="sub">{r.channel === "dm" ? "Direct message" : "#" + chName(r.channel)} · {r.day}</span></div>
              <span className="muted" style={{ fontSize: "var(--text-micro)" }}>{timeText(r.time)}</span>
            </div>
          )) : <Empty title="Nothing scheduled">Turn on an automation to see it here.</Empty>}
        </section>

        <section className="tile s7 link" tabIndex={0} onClick={() => go("analytics", { an: "community", ct: "overview" })}>
          <div className="th"><h2>Community pulse</h2><div className="r"><a className="more" href="#analytics">Community analytics <Ico name="arrow" /></a></div></div>
          <div className="minis">
            <div className="mini"><div className="l">Members</div><div className="v">{int(members.length)}</div></div>
            <div className="mini"><div className="l">Messages</div><div className="v">{int(M.daily.reduce((n, x) => n + x.msgs, 0))}</div></div>
            <div className="mini"><div className="l">Onboarding done</div><div className="v">{started.length ? Math.round((started.filter((t) => t.status === "done" || t.status === "needs").length / started.length) * 100) + "%" : "—"}</div></div>
          </div>
          {tracking ? <LineChart data={M.daily} keys={[{ k: "active", c: "var(--color-accent)" }]} h={110} /> : <Empty>The bot starts counting activity from the first message it sees in your server.</Empty>}
        </section>

        <section className="tile s5">
          <div className="th"><h2>Latest DMs</h2><div className="r"><a className="more" href="#onboarding">Inbox <Ico name="arrow" /></a></div></div>
          {dms.length ? dms.slice(0, 4).map((m) => {
            const last = m.msgs[m.msgs.length - 1];
            return (
              <div key={m.userId} className="lrow" style={{ cursor: "pointer" }} onClick={() => go("onboarding", { ob: "inbox", dm: m.userId })}>
                <span className="cav">{initials(m.name)}</span>
                <div style={{ minWidth: 0 }}><b>{m.name}</b><span className="sub">{last ? (last.from === "bot" ? "Bot: " : "") + last.text : m.error || "No messages yet"}</span></div>
                {m.unread ? <span className="pill rose">New</span> : <span className="muted" style={{ fontSize: "var(--text-micro)" }}>{ago(m.updatedAt)}</span>}
              </div>
            );
          }) : <Empty title="No DMs yet">New members get your welcome DM when they join.</Empty>}
        </section>
      </div>
    </>
  );
}
