import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./site.css";
import "./setup.css";
import App from "./App.jsx";
import { db } from "./services/db.js";
import { auth } from "./services/auth.js";

// Each account has its own workspace data. Registered before React subscribes,
// so the right store is opening by the time the app re-renders for a new session.
const openStore = () => db.open(auth.user()?.workspace).catch(() => {});
auth.subscribe(openStore);

// Know who is signed in before the first render, so pages don't flash the wrong screen.
await auth.init();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
