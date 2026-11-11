import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { AppProvider } from "./context/AppContext.jsx";
import { startWorker } from "./services/worker.js";
import { seedDemoIfNeeded } from "./services/seed.js";

// Open on a ready demo workspace instead of an empty setup guide.
seedDemoIfNeeded();

// The worker stands in for the Claude session that runs the Discord bot:
// it picks up requests (sync, allowlist, draft, post, reject) from the store.
startWorker();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
