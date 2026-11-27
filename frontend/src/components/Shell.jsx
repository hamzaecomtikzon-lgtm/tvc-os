/*
 * The signed-in app frame: grouped sidebar (collapsible to icons), a top bar with breadcrumbs,
 * quick find (⌘K / Ctrl+K), help and notifications, and the page itself.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../context/app.js";
import { useHashTab } from "../hooks/useHashTab.js";
import { auth } from "../services/auth.js";
import { BRAND } from "../lib/brand.js";
import { AUTOS, COMM_TABS, TABS } from "../lib/constants.js";
import { BotAvatar, Ico, Pop, Skel, Toast } from "./ui.jsx";
import { Logo } from "./site.jsx";
import CreatorDrawer from "./CreatorDrawer.jsx";
import Dashboard from "../pages/Dashboard.jsx";
import Analytics from "../pages/Analytics.jsx";
import Approvals from "../pages/Approvals.jsx";
import Automations from "../pages/Automations.jsx";
import Builder from "../pages/Builder.jsx";
import Onboarding from "../pages/Onboarding.jsx";
import Content from "../pages/Content.jsx";
import Settings from "../pages/Settings.jsx";
import AuditLogs from "../pages/AuditLogs.jsx";
import KreoBot from "../pages/KreoBot.jsx";
import CreatorSearch from "../pages/CreatorSearch.jsx";
import SetupOverlay from "../pages/SetupOverlay.jsx";

const PAGES = { dashboard: Dashboard, analytics: Analytics, approvals: Approvals, automations: Automations, "automation-builder": Builder, onboarding: Onboarding, content: Content, workspace: Settings, "audit-logs": AuditLogs, "kreo-bot": KreoBot, "creator-search": CreatorSearch };
const TRIAL_DAYS = 14;

/** Sidebar sections. `show` hides an item from people who can't use it. */
const NAV = [
  { items: [["dashboard", "Dashboard", "home"]] },
  { label: "Insights", items: [["analytics", "Analytics", "chart"]] },
  { label: "Creators", items: [["creator-search", "Creator search", "search"], ["onboarding", "Onboarding & DMs", "chat"]] },
  { label: "Community", items: [["approvals", "Approvals", "check"], ["automations", "Automations", "bolt"], ["content", "Content", "play"]] },
  { label: "Workspace", items: [["workspace", "Settings", "gear"], ["audit-logs", "Audit logs", "shield", (a) => a.isAdmin]] },
  { label: "Platform", items: [["kreo-bot", "KREO bot", "server", (a) => a.conn.platformAdmin]] },
];
const SECTION = Object.fromEntries(NAV.flatMap((s) => s.items.map(([k]) => [k, s.label])));
SECTION["automation-builder"] = "Community";

const SETTINGS_TABS = { workspace: "Workspace", bot: "Bot & server", channels: "Channels", crm: "CRM & data", team: "Team", notifications: "Notifications", billing: "Plan & billing" };
const OB_TABS = { inbox: "Inbox", questions: "Questions", responses: "Responses" };
const AP_TABS = { pending: "Waiting on you", posted: "Posted", rejected: "Rejected" };

/** One or two sentences per page for the help menu. */
const PAGE_HELP = {
  dashboard: "Your community at a glance: sales from your CRM, what’s waiting for approval, and what the bot will post next.",
  analytics: "Community analytics shows what creators do in your Discord. Overall (CRM) shows your whole TikTok Shop program. Use the date range at the top right.",
  "creator-search": "Find creators who joined KREO. Ask in plain words (“L1–L2 health creators in the US”), save them to shortlists and message them. If they’re not in your server, KREO introduces you.",
  onboarding: "The welcome DM new members get, the questions it asks, and every DM conversation with creators. Unread replies are marked.",
  approvals: "Every post waits here (and in your moderators’ channel) until someone approves it. In Discord, react ✅ or reply “approved”.",
  automations: "Turn the bot’s automations on, pick their channels and times, or build your own.",
  "automation-builder": "Describe a custom automation in plain words and the AI builder sets it up.",
  content: "Content ideas and videos from your creators.",
  workspace: "Your workspace, bot, channels, CRM connection, team and plan.",
  "audit-logs": "Who did what and when, for owners and admins.",
  "kreo-bot": "The platform’s official KREO bot: servers, invites, the creator database and test DMs.",
};

const readCollapsed = () => { try { return localStorage.getItem("kreo.side") === "collapsed"; } catch { return false; } };
const typing = () => /input|textarea|select/i.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable;
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");
const MOD = isMac ? "⌘" : "Ctrl";

function Side({ tab, open, close, collapsed }) {
  const app = useApp();
  const { guild, botName, autos, customs, drafts, dms, user, go } = app;
  const badge = {
    approvals: drafts.filter((d) => d.status === "pending").length,
    automations: AUTOS.filter((a) => autos[a.key]?.enabled).length + customs.filter((c) => c.on).length,
    onboarding: dms.filter((d) => d.unread).length,
  };
  const left = Math.max(0, TRIAL_DAYS - Math.floor((Date.now() - Date.parse(user.createdAt || Date.now())) / 864e5));
  return (
    <>
      {open && <button className="side-bg" type="button" aria-label="Close navigation" onClick={close} />}
      <aside className={"side" + (open ? " open" : "")}>
        <Logo href="#dashboard" className="logo" />
        <button className="ws" type="button" title={collapsed ? `${botName} · ${guild ? guild.guildName : "No server yet"}` : undefined} onClick={() => go("workspace", { set: "bot" })}>
          <div className="bav"><BotAvatar /></div>
          <div className="ws-txt" style={{ minWidth: 0 }}><b>{botName}</b><span>{guild && <i className="dot-ok" />}<span>{guild ? guild.guildName : "No server yet"}</span></span></div>
        </button>
        <nav aria-label="App">
          {NAV.map((s, i) => {
            const items = s.items.filter(([, , , show]) => !show || show(app));
            if (!items.length) return null;
            return (
              <div className="navgroup" key={s.label || i}>
                {s.label && <div className="navlabel">{s.label}</div>}
                {items.map(([k, label, icon]) => {
                  const on = tab === k || (k === "automations" && tab === "automation-builder");
                  const n = badge[k];
                  return (
                    <a key={k} href={"#" + k} className={on ? "on" : ""} aria-current={on ? "page" : undefined} title={collapsed ? label + (n ? ` (${n})` : "") : undefined} aria-label={collapsed ? label : undefined}>
                      <Ico name={icon} /><span className="navtxt">{label}</span>
                      {k in badge && (k === "automations" || n > 0) && <small className={k === "approvals" ? "hot" : ""}>{n}</small>}
                    </a>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="trial">
          <b>{left ? `Free trial · ${left} day${left === 1 ? "" : "s"} left` : "Free trial ended"}</b>
          <div className="prog"><i style={{ width: ((TRIAL_DAYS - left) / TRIAL_DAYS) * 100 + "%" }} /></div>
          <span>Billing isn’t connected yet, so nothing is charged.</span>
          <button className="btn sm subtle" type="button" onClick={() => go("workspace", { set: "billing" })}>See plans</button>
        </div>
      </aside>
    </>
  );
}

/** Where you are: Brand › Section › Page › Tab. */
function crumbsFor(tab, view, brand) {
  const out = [{ label: brand, to: ["dashboard"] }];
  if (SECTION[tab]) out.push({ label: SECTION[tab] });
  if (tab === "automation-builder") out.push({ label: "Automations", to: ["automations"] }, { label: view.id ? "Edit automation" : "Custom automation" });
  else if (tab !== "dashboard") out.push({ label: TABS[tab], to: [tab] });
  if (tab === "analytics") {
    const an = view.an || "community";
    out.push({ label: an === "community" ? "Community analytics" : "Overall (CRM)", to: ["analytics", { an }] });
    if (an === "community") out.push({ label: (COMM_TABS.find(([k]) => k === (view.ct || "overview")) || [, "Overview"])[1] });
  }
  if (tab === "workspace") out.push({ label: SETTINGS_TABS[view.set || "workspace"] || "Workspace" });
  if (tab === "onboarding") out.push({ label: OB_TABS[view.ob || "inbox"] || "Inbox" });
  if (tab === "approvals") out.push({ label: AP_TABS[view.ap || "pending"] || "Waiting on you" });
  return out;
}

function Crumbs({ tab }) {
  const { user, view, go } = useApp();
  const list = crumbsFor(tab, view, user.brand);
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <ol>
        {list.map((c, i) => {
          const last = i === list.length - 1;
          return (
            <li key={i} className={(last ? "cur" : "") + (i === 0 ? " home" : "")}>
              {i > 0 && <Ico name="chevRight" className="ico sep" />}
              {!last && c.to ? <button type="button" onClick={() => go(...c.to)}>{c.label}</button> : <span aria-current={last ? "page" : undefined}>{c.label}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** ⌘K quick find: jump to any page, or look up creators. */
function QuickFind({ onClose }) {
  const app = useApp();
  const { go } = app;
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); }, []);
  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    const pages = NAV.flatMap((s) => s.items.filter(([, , , show]) => !show || show(app)).map(([k, label, icon]) => ({ key: k, label, icon, hint: s.label || "", run: () => go(k) })));
    const settings = Object.entries(SETTINGS_TABS).map(([set, label]) => ({ key: "set-" + set, label: label, icon: "gear", hint: "Settings", run: () => go("workspace", { set }) }));
    const all = [...pages, ...settings].filter((x) => !t || x.label.toLowerCase().includes(t) || x.hint.toLowerCase().includes(t));
    const finds = q.trim() ? [
      { key: "find-cs", label: `Find creators: “${q.trim()}”`, icon: "spark", hint: "Creator search (AI)", run: () => go("creator-search", { csq: q.trim() }) },
      { key: "find-an", label: `Search your creators for “${q.trim()}”`, icon: "users", hint: "Analytics → Creators", run: () => go("analytics", { an: "community", ct: "creators", q: q.trim() }) },
    ] : [];
    // A matching page name comes first ("approv" → Approvals); otherwise a typed query is a creator search.
    return (all.length && t ? [...all, ...finds] : [...finds, ...all]).slice(0, 12);
  }, [q, app, go]);
  useEffect(() => { setSel(0); }, [q]);
  const pick = (x) => { onClose(); x.run(); };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter" && items[sel]) { e.preventDefault(); pick(items[sel]); }
    else if (e.key === "Escape") onClose();
  };
  return (
    <div className="qf-bg" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="qf" role="dialog" aria-modal="true" aria-label="Quick find">
        <div className="qf-in"><Ico name="search" /><input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Jump to a page, or find creators, @handles…" aria-label="Quick find" role="combobox" aria-expanded="true" aria-controls="qf-list" aria-activedescendant={items[sel] ? "qf-" + items[sel].key : undefined} /><kbd>Esc</kbd></div>
        <ul id="qf-list" role="listbox">
          {items.map((x, i) => (
            <li key={x.key} id={"qf-" + x.key} role="option" aria-selected={i === sel} className={i === sel ? "on" : ""} onMouseEnter={() => setSel(i)} onClick={() => pick(x)}>
              <Ico name={x.icon} /><span>{x.label}</span><small>{x.hint}</small>
            </li>
          ))}
          {!items.length && <li className="qf-empty">Nothing matches. Try a page name like “approvals”.</li>}
        </ul>
        <div className="qf-foot"><span><kbd>↑</kbd><kbd>↓</kbd> to move</span><span><kbd>Enter</kbd> to open</span><span><kbd>{MOD}</kbd><kbd>K</kbd> anytime</span></div>
      </div>
    </div>
  );
}

function HelpMenu({ tab, onFind, onToggleSide }) {
  const { go } = useApp();
  return (
    <Pop className="pop help-pop" button={(toggle) => <button className="iconbtn" type="button" aria-label="Help" aria-haspopup="true" title="Help" onClick={toggle}><Ico name="help" /></button>}>
      {(close) => (
        <>
          <div className="ph2"><b>Help</b><span className="muted">{TABS[tab]}</span></div>
          <p className="help-tip">{PAGE_HELP[tab]}</p>
          <div className="help-keys">
            <b>Keyboard shortcuts</b>
            <div><span>Quick find</span><span><kbd>{MOD}</kbd><kbd>K</kbd></span></div>
            <div><span>Collapse or expand the sidebar</span><span><kbd>[</kbd></span></div>
          </div>
          <button className="pi" type="button" onClick={() => { close(); onFind(); }}><Ico name="search" />Quick find</button>
          <button className="pi" type="button" onClick={() => { close(); onToggleSide(); }}><Ico name="sidebar" />Collapse or expand the sidebar</button>
          <button className="pi" type="button" onClick={() => { close(); go("workspace", { set: "bot" }); }}><Ico name="server" />Bot & server setup</button>
          <button className="pi" type="button" onClick={() => { close(); go("workspace", { set: "billing" }); }}><Ico name="card" />Plan & billing</button>
        </>
      )}
    </Pop>
  );
}

function Topbar({ tab, onSide, collapsed, onFind }) {
  const { user, drafts, dms, cfg, chName, go, conn, ws } = useApp();
  const pending = drafts.filter((d) => d.status === "pending").length;
  const unread = dms.filter((d) => d.unread);
  const offline = ws.done && conn.discord.configured && conn.gateway.connected === false;
  const count = pending + unread.length + (offline ? 1 : 0);
  const signOut = () => {
    auth.signOut();
    location.hash = "#home";
  };
  return (
    <header className="topbar">
      <button className="iconbtn side-toggle" type="button" onClick={onSide} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={`${collapsed ? "Expand" : "Collapse"} sidebar  [`}><Ico name="sidebar" /></button>
      <Crumbs tab={tab} />
      <div className="r">
        <button className="qf-btn" type="button" onClick={onFind} aria-label="Quick find" title={`Quick find  ${MOD}+K`}><Ico name="search" /><span>Find</span><kbd>{MOD} K</kbd></button>
        <HelpMenu tab={tab} onFind={onFind} onToggleSide={onSide} />
        <Pop button={(toggle) => (
          <button className="iconbtn" type="button" aria-label="Notifications" aria-haspopup="true" title="Notifications" onClick={toggle}><Ico name="bell" />{count > 0 && <i className="badge-dot" />}</button>
        )}>
          {(close) => (
            <>
              <div className="ph2"><b>Notifications</b></div>
              {pending > 0 && <button className="note" type="button" onClick={() => { close(); go("approvals", { ap: "pending" }); }}><span className="todo-i"><Ico name="check" /></span><div>{pending} draft{pending === 1 ? "" : "s"} waiting for approval<span>{cfg.modChannel ? "Also posted in #" + chName(cfg.modChannel) : "No approvals channel set"}</span></div></button>}
              {unread.length > 0 && <button className="note" type="button" onClick={() => { close(); go("onboarding", { ob: "inbox", dm: unread[0].userId }); }}><span className="todo-i b"><Ico name="chat" /></span><div>{unread.length} creator DM{unread.length === 1 ? "" : "s"} need a reply<span>Latest from {unread[0].name}</span></div></button>}
              {offline && <button className="note" type="button" onClick={() => { close(); go("workspace", { set: "bot" }); }}><span className="todo-i"><Ico name="plug" /></span><div>The bot isn’t listening to Discord<span>{conn.gateway.error || "Reconnecting…"}</span></div></button>}
              {!count && <div className="empty"><b>All caught up</b>New drafts and DMs show up here.</div>}
            </>
          )}
        </Pop>
        <Pop button={(toggle) => <button className="avatar-btn" type="button" aria-label="Account menu" aria-haspopup="true" onClick={toggle}>{(user.name[0] || "?").toUpperCase()}</button>}>
          {(close) => (
            <>
              <div className="ph2"><b>{user.name}</b><span className="muted">{user.brand} · {user.role}</span></div>
              {[["workspace", "Workspace settings", "gear"], ["team", "Team", "users"], ["billing", "Plan & billing", "card"]].map(([set, label, icon]) => (
                <button key={set} className="pi" type="button" onClick={() => { close(); go("workspace", { set }); }}><Ico name={icon} />{label}</button>
              ))}
              <a className="pi" href="#home" onClick={close}><Ico name="home" />{BRAND} home page</a>
              <button className="pi" type="button" onClick={signOut}><Ico name="logout" />Sign out</button>
            </>
          )}
        </Pop>
      </div>
    </header>
  );
}

export default function Shell() {
  const hashTab = useHashTab();
  const { booted, serverOk, ws, creator } = useApp();
  const [menu, setMenu] = useState(false); // phone drawer
  const [collapsed, setCollapsed] = useState(readCollapsed); // desktop icons-only
  const [finding, setFinding] = useState(false);

  // Until setup is finished, the dashboard sits blurred behind the setup steps.
  const locked = booted && serverOk && !ws.done;
  const tab = locked ? "dashboard" : hashTab;

  useEffect(() => {
    window.scrollTo(0, 0);
    setMenu(false);
  }, [tab]);

  const toggleSide = useCallback(() => {
    if (window.matchMedia("(max-width: 900px)").matches) return setMenu((m) => !m);
    setCollapsed((c) => {
      try { localStorage.setItem("kreo.side", c ? "open" : "collapsed"); } catch { /* storage blocked */ }
      return !c;
    });
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setFinding((f) => !f); return; }
      if (typing() || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") { e.preventDefault(); setFinding(true); }
      else if (e.key === "[") { e.preventDefault(); toggleSide(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggleSide]);

  let view;
  if (!booted) view = <div className="tile"><Skel n={6} /></div>;
  else if (!serverOk) view = <div className="tile"><div className="empty"><b>Can’t reach the server</b>Start the backend (npm start in the backend folder), then reload this page.</div></div>;
  else {
    const Page = PAGES[tab];
    view = <Page key={tab} />;
  }

  return (
    <div className="kreo">
      <div className={"app" + (locked ? " locked" : "") + (collapsed ? " collapsed" : "")} inert={locked} aria-hidden={locked || undefined}>
        <Side tab={tab} open={menu} close={() => setMenu(false)} collapsed={collapsed} />
        <div className="main">
          <Topbar tab={tab} onSide={toggleSide} collapsed={collapsed} onFind={() => setFinding(true)} />
          <main className="page" id="page">{view}</main>
        </div>
      </div>
      {finding && !locked && <QuickFind onClose={() => setFinding(false)} />}
      {locked && <SetupOverlay />}
      {creator && !locked && <CreatorDrawer />}
      <Toast />
    </div>
  );
}
