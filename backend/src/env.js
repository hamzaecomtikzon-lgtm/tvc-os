/* Loads backend/.env before anything else reads process.env. */
import { fileURLToPath } from "node:url";
import net from "node:net";

// Node gives each address (IPv4, then IPv6) only 250 ms to connect before moving on. On a slow link with no
// working IPv6 that makes outgoing calls (Google sign-in, Discord) fail with ETIMEDOUT, so allow longer.
net.setDefaultAutoSelectFamilyAttemptTimeout(5000);

try {
  // fileURLToPath, not .pathname: the folder name may contain spaces.
  process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
} catch (e) {
  if (e.code !== "ENOENT") console.error("Couldn't read backend/.env:", e.message);
}
