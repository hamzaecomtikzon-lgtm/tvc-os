import { useApp } from "../context/app.js";
import { useCreators } from "../hooks/useCommunity.js";
import { fmtDate, initials, int, rangeText } from "../lib/format.js";
import { Drawer, Ico } from "./ui.jsx";

/** Everything known about one creator: sales and contact details from the CRM, activity and DMs from Discord. */
export default function CreatorDrawer() {
  const { creator, openCreator, money, crmName, range, go, toast } = useApp();
  const { rows } = useCreators();
  const c = rows.find((r) => r.key === creator);
  const close = () => openCreator(null);
  if (!c) return null;
  const t = c.member?.thread;
  const copy = (v) => navigator.clipboard?.writeText(v).then(() => toast("Copied " + v), () => toast(v));
  const Row = ({ k, v, src, canCopy }) => (
    <div>
      <span className="k">{k}</span>
      <span className="v">{v || "—"} {v && src && <span className={"src" + (src === "dm" ? " dm" : "")}>{src === "dm" ? "Found in DM" : "CRM"}</span>}</span>
      {v && canCopy ? <button className="btn sm ghost" type="button" onClick={() => copy(v)}>Copy</button> : <span />}
    </div>
  );
  return (
    <Drawer
      title={<span style={{ display: "flex", gap: 10, alignItems: "center" }}><span className="cav r">{initials(c.name || c.handle)}</span>{c.handle ? "@" + c.handle : c.name}</span>}
      onClose={close}
      footer={<>
        {t && <button className="btn" type="button" onClick={() => go("onboarding", { ob: "inbox", dm: t.userId })}><Ico name="chat" />Open DM</button>}
        {c.handle && <a className="btn" href={"https://www.tiktok.com/@" + c.handle} target="_blank" rel="noopener noreferrer"><Ico name="external" />View on TikTok</a>}
      </>}
    >
      <div className="kpis6" style={{ gridTemplateColumns: "repeat(3, 1fr)", margin: 0 }}>
        <div className="kp"><div className="l">GMV</div><div className="v">{c.inCrm ? money(c.gmv, true) : "—"}</div></div>
        <div className="kp"><div className="l">Sales</div><div className="v">{c.inCrm ? int(c.sales) : "—"}</div></div>
        <div className="kp"><div className="l">Videos</div><div className="v">{c.inCrm ? int(c.videos) : "—"}</div></div>
      </div>
      <div>
        <div className="sec-t">Contact</div>
        <div className="dl">
          <Row k="Name" v={c.name} />
          <Row k="Email" v={c.email} src="crm" canCopy />
          <Row k="Phone" v={c.phone} src="crm" canCopy />
          <Row k="WhatsApp" v={c.wa} src={c.waSrc} canCopy />
          <Row k="Discord" v={c.member ? "@" + c.member.user : ""} />
          <Row k="TikTok" v={c.handle ? "@" + c.handle : ""} />
        </div>
        {!c.inCrm && <p className="muted" style={{ fontSize: "var(--text-micro)", marginTop: 8 }}>{c.handle ? `@${c.handle} isn’t a creator in ${crmName}, so there are no sales numbers.` : "This member hasn’t shared a TikTok handle yet, so they aren’t linked to a creator."}</p>}
      </div>
      <div>
        <div className="sec-t">Activity</div>
        <div className="tl">
          {c.sales > 0 && <div><i /><b style={{ fontWeight: 500 }}>Made {int(c.sales)} sales</b><span>{rangeText(range).split(" · ").pop()}</span></div>}
          {c.member && <div><i /><span style={{ color: "var(--color-text)" }}>{int(c.msgs)} messages in Discord, active {c.activeDays} day{c.activeDays === 1 ? "" : "s"}</span><span>this range</span></div>}
          {t && <div><i /><span style={{ color: "var(--color-text)" }}>Onboarding: {{ done: "finished", needs: "finished", progress: "in progress", closed: "DM couldn’t be delivered" }[t.status]}</span><span>{fmtDate(t.startedAt)}</span></div>}
          {c.joined && <div><i /><span style={{ color: "var(--color-text)" }}>Joined the server</span><span>{fmtDate(c.joined)}</span></div>}
          {!c.member && <div><i /><span style={{ color: "var(--color-text)" }}>Not in your Discord yet</span><span /></div>}
        </div>
      </div>
    </Drawer>
  );
}
