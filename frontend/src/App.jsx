import { useEffect, useState } from "react";
import "./app.css";
import { useApp } from "./context/app.js";
import { AppProvider } from "./context/AppContext.jsx";
import { useHash, useHashTab } from "./hooks/useHashTab.js";
import { auth, useAuth } from "./services/auth.js";
import { APP_HOME, BRAND } from "./lib/brand.js";
import { AUTOS, TABS } from "./lib/constants.js";
import { BotAvatar, Ico, Pop, Skel, Toast } from "./components/ui.jsx";
import { Logo } from "./components/site.jsx";
import CreatorDrawer from "./components/CreatorDrawer.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Analytics from "./pages/Analytics.jsx";
import Approvals from "./pages/Approvals.jsx";
import Automations from "./pages/Automations.jsx";
import Builder from "./pages/Builder.jsx";
import Onboarding from "./pages/Onboarding.jsx";
import Content from "./pages/Content.jsx";
import Settings from "./pages/Settings.jsx";
import Landing from "./pages/Landing.jsx";
import Auth from "./pages/Auth.jsx";
import SetupOverlay from "./pages/SetupOverlay.jsx";

const PAGES = { dashboard: Dashboard, analytics: Analytics, approvals: Approvals, automations: Automations, "automation-builder": Builder, onboarding: Onboarding, content: Content, workspace: Settings };
const NAV = [["dashboard", "Dashboard", "home"], ["analytics", "Analytics", "chart"], ["approvals", "Approvals", "check"], ["automations", "Automations", "bolt"], ["onboarding", "Onboarding & DMs", "chat"], ["content", "Content", "play"]];
const TRIAL_DAYS = 14;

const AUTH_ROUTES = ["signin", "signup"];
const NEXT_KEY = "tvc.next";
const takeNext = () => {
  try {
    const next = sessionStorage.getItem(NEXT_KEY);
    sessionStorage.removeItem(NEXT_KEY);
    return TABS[next] ? next : APP_HOME;
  } catch {
    return APP_HOME;
  }
};

/**
 * Routes (URL hash):
 *   #home, #features, #how, …     public home page
 *   #signin, #signup              account screens (signed-out only)
 *   #dashboard, #analytics, …     the app (signed-in only)
 */
export default function App() {
  const hash = useHash();
  const user = useAuth();
  const isAuth = AUTH_ROUTES.includes(hash);
  const isApp = Boolean(TABS[hash]) || hash === "";

  // Signed out on an app page: sign in first, then come back to it.
  // Signed in on an account screen: go to the app.
  const redirect = !user && TABS[hash] ? "signin" : user && isAuth ? "app" : null;
  useEffect(() => {
    if (redirect === "signin") {
      try { sessionStorage.setItem(NEXT_KEY, hash); } catch { /* storage blocked */ }
      location.replace("#signin");
    } else if (redirect === "app") {
      location.replace("#" + takeNext());
    }
  }, [redirect, hash]);

  if (redirect) return null;
  if (user && isApp) return <AppProvider key={user.workspace}><Shell /></AppProvider>;
  if (isAuth) return <Auth key={hash} mode={hash} />;
  return <Landing hash={hash} user={user} />;
}

function Side({ tab, open, close }) {
  const { guild, botName, autos, customs, drafts, dms, user, go } = useApp();
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
        <button className="ws" type="button" onClick={() => go("workspace", { set: "bot" })}>
          <div className="bav"><BotAvatar /></div>
          <div style={{ minWidth: 0 }}><b>{botName}</b><span>{guild && <i className="dot-ok" />}<span>{guild ? guild.guildName : "No server yet"}</span></span></div>
        </button>
        <nav aria-label="App">
          {NAV.map(([k, label, icon]) => (
            <a key={k} href={"#" + k} className={tab === k || (k === "automations" && tab === "automation-builder") ? "on" : ""} aria-current={tab === k ? "page" : undefined}>
              <Ico name={icon} />{label}
              {k in badge && (k === "automations" || badge[k] > 0) && <small className={k === "approvals" ? "hot" : ""}>{badge[k]}</small>}
            </a>
          ))}
          <div className="navlabel">Workspace</div>
          <a href="#workspace" className={tab === "workspace" ? "on" : ""}><Ico name="gear" />Settings</a>
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

function Topbar({ onMenu }) {
  const { user, drafts, dms, cfg, chName, go, conn, ws } = useApp();
  const pending = drafts.filter((d) => d.status === "pending").length;
  const unread = dms.filter((d) => d.unread);
  const offline = ws.done && conn.discord.configured && conn.gateway.connected === false;
  const count = pending + unread.length + (offline ? 1 : 0);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) {
        e.preventDefault();
        document.getElementById("gSearch")?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const search = (e) => {
    if (e.key !== "Enter") return;
    go("analytics", { an: "community", ct: "creators", q: e.target.value.trim() });
    e.target.blur();
  };
  const signOut = () => {
    auth.signOut();
    location.hash = "#home";
  };

  return (
    <header className="topbar">
      <button className="iconbtn menu-toggle" type="button" aria-label="Open navigation" onClick={onMenu}><Ico name="menu" /></button>
      <div className="search"><Ico name="search" /><input className="input" id="gSearch" placeholder="Search creators, @handles, emails" aria-label="Search" onKeyDown={search} /><kbd>/</kbd></div>
      <div className="r">
        <Pop button={(toggle) => (
          <button className="iconbtn" type="button" aria-label="Notifications" aria-haspopup="true" onClick={toggle}><Ico name="bell" />{count > 0 && <i className="badge-dot" />}</button>
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

function Shell() {
  const hashTab = useHashTab();
  const { booted, serverOk, ws, creator } = useApp();
  const [menu, setMenu] = useState(false);

  // Until setup is finished, the dashboard sits blurred behind the setup steps.
  const locked = booted && serverOk && !ws.done;
  const tab = locked ? "dashboard" : hashTab;

  useEffect(() => {
    window.scrollTo(0, 0);
    setMenu(false);
  }, [tab]);

  let view;
  if (!booted) view = <div className="tile"><Skel n={6} /></div>;
  else if (!serverOk) view = <div className="tile"><div className="empty"><b>Can’t reach the server</b>Start the backend (npm start in the backend folder), then reload this page.</div></div>;
  else {
    const Page = PAGES[tab];
    view = <Page key={tab} />;
  }

  return (
    <div className="kreo">
      <div className={"app" + (locked ? " locked" : "")} inert={locked} aria-hidden={locked || undefined}>
        <Side tab={tab} open={menu} close={() => setMenu(false)} />
        <div className="main">
          <Topbar onMenu={() => setMenu(true)} />
          <main className="page" id="page">{view}</main>
        </div>
      </div>
      {locked && <SetupOverlay />}
      {creator && !locked && <CreatorDrawer />}
      <Toast />
    </div>
  );
}
