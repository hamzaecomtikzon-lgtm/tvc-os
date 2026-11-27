import { useEffect } from "react";
import "./app.css";
import { AppProvider } from "./context/AppContext.jsx";
import { useHash } from "./hooks/useHashTab.js";
import { useAuth } from "./services/auth.js";
import { APP_HOME } from "./lib/brand.js";
import { TABS } from "./lib/constants.js";
import Shell from "./components/Shell.jsx";
import Landing from "./pages/Landing.jsx";
import Auth from "./pages/Auth.jsx";
import Join from "./pages/Join.jsx";

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
 *   #join/<token>                 a creator joining KREO from its invite DM (public)
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

  // KREO’s invite button: public, signed in or not.
  if (hash.startsWith("join/")) return <Join key={hash} token={hash.slice(5)} />;
  if (redirect) return null;
  if (user && isApp) return <AppProvider key={user.workspace}><Shell /></AppProvider>;
  if (isAuth) return <Auth key={hash} mode={hash} />;
  return <Landing hash={hash} user={user} />;
}
