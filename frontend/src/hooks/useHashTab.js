import { useSyncExternalStore } from "react";
import { TABS } from "../lib/constants.js";

const subscribe = (fn) => {
  window.addEventListener("hashchange", fn);
  return () => window.removeEventListener("hashchange", fn);
};
const read = () => {
  const h = location.hash.replace("#", "");
  return TABS[h] ? h : "dashboard";
};

const readRaw = () => location.hash.replace("#", "");

/** The raw URL hash without the "#" ("" when there is none). */
export function useHash() {
  return useSyncExternalStore(subscribe, readRaw);
}

/** Current tab from the URL hash (#dashboard, #automations, …). */
export function useHashTab() {
  return useSyncExternalStore(subscribe, read);
}

export const go = (tab) => {
  location.hash = "#" + tab;
};
