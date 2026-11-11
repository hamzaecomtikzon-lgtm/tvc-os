import { useEffect } from "react";
import { useApp } from "./context/app.js";
import { useHashTab } from "./hooks/useHashTab.js";
import { DISCORD_TABS, SHOP_TABS } from "./lib/constants.js";
import Rail from "./components/Rail.jsx";
import Topbar from "./components/Topbar.jsx";
import { Hero, Skel, Toast } from "./components/ui.jsx";
import Overview from "./pages/Overview.jsx";
import Content from "./pages/Content.jsx";
import Community from "./pages/Community.jsx";
import Automations from "./pages/Automations.jsx";
import Approvals from "./pages/Approvals.jsx";
import Onboarding from "./pages/Onboarding.jsx";
import Setup from "./pages/Setup.jsx";
import Wizard from "./pages/Wizard.jsx";

const PAGES = { overview: Overview, content: Content, community: Community, automations: Automations, approvals: Approvals, onboarding: Onboarding, setup: Setup };

export default function App() {
  const hashTab = useHashTab();
  const { booted, ws, gid, shop } = useApp();

  // Until setup is finished, every route shows the setup guide.
  const tab = booted && !ws.done ? "welcome" : hashTab;
  const needsGuild = booted && ws.done && !gid && DISCORD_TABS.includes(tab);

  useEffect(() => {
    if (needsGuild) location.hash = "#welcome";
  }, [needsGuild]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);

  let view;
  if (!booted) view = <div className="card"><Skel n={6} /></div>;
  else if (tab === "welcome" || needsGuild) view = <Wizard />;
  else if (SHOP_TABS.includes(tab) && !shop) {
    view = <>
      <Hero eyebrow="Live data" title="Connect Cruva" />
      <div className="err">Cruva isn’t connected. Add it in Settings → Connectors, then press Refresh.</div>
    </>;
  } else {
    const Page = PAGES[tab];
    view = <Page key={tab} />;
  }

  return (
    <>
      <div className="app">
        <Rail tab={tab} />
        <div className="work">
          <Topbar tab={tab} />
          <main className="inner" id="view">{view}</main>
        </div>
      </div>
      <Toast />
    </>
  );
}
