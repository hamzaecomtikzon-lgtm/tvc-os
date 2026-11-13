/*
 * Accounts and the signed-in session. The server keeps the session in an
 * HttpOnly cookie; this module holds the current user for the UI.
 */
import { useSyncExternalStore } from "react";
import { api } from "./api.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const MIN_PASSWORD = 8;

let current = null; // { id, name, brand, email, provider, workspace, role, createdAt } (stable identity between changes)
const listeners = new Set();
// Lets other tabs follow a sign-in or sign-out made in this one.
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("kreo-auth");

function setUser(user, announce = true) {
  const sig = (u) => (u ? [u.id, u.name, u.brand, u.role].join("|") : "");
  if (sig(current) === sig(user)) return current;
  current = user || null;
  listeners.forEach((l) => l());
  if (announce) channel?.postMessage("changed");
  return current;
}

async function refresh() {
  setUser((await api("GET", "/auth/me")).user, false);
}
if (channel) channel.onmessage = () => refresh().catch(() => {});

/** Field errors for the sign-up / sign-in forms: `{ field: message }`, empty when valid. */
export function validate(mode, { name, brand, email, password }) {
  const errors = {};
  const mail = String(email || "").trim();
  if (mode === "signup") {
    if (!String(name || "").trim()) errors.name = "Enter your name.";
    if (!String(brand || "").trim()) errors.brand = "Enter your brand name.";
  }
  if (!mail) errors.email = "Enter your email.";
  else if (!EMAIL_RE.test(mail)) errors.email = "Enter a valid email, like jordan@glowlab.co.";
  if (!password) errors.password = "Enter your password.";
  else if (mode === "signup" && password.length < MIN_PASSWORD) errors.password = `Use at least ${MIN_PASSWORD} characters.`;
  return errors;
}

export const auth = {
  user: () => current,

  /** Find out who is signed in. Call once before the first render. */
  async init() {
    try {
      await refresh();
    } catch {
      /* server unreachable: start signed out; the sign-in form reports it */
    }
  },

  async signUp(values) {
    return setUser((await api("POST", "/auth/signup", values)).user);
  },

  async signIn(values) {
    return setUser((await api("POST", "/auth/signin", values)).user);
  },

  /** Leave for Google's sign-in page. Rejects (with a message to show) when Google sign-in isn't set up. */
  async google() {
    location.href = (await api("GET", "/auth/google/url?origin=" + encodeURIComponent(location.origin))).url;
  },

  /** Change your name (and the brand name, for the owner). */
  async update(values) {
    return setUser((await api("PUT", "/account", values)).user);
  },

  signOut() {
    setUser(null);
    api("POST", "/auth/signout").catch(() => {});
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

/** The signed-in user (`{ id, name, brand, email, provider }`) or null. */
export function useAuth() {
  return useSyncExternalStore(auth.subscribe, auth.user);
}
