import { useSyncExternalStore } from "react";
import { TABS } from "../lib/constants.js";

const subscribe = (fn) => {
  window.addEventListener("hashchange", fn);
  return () => window.removeEventListener("hashchange", fn);
};
const read = () => {
  const h = location.hash.replace("#", "");
  return TABS[h] ? h : "overview";
};

/** Current tab from the URL hash (#overview, #automations, …). */
export function useHashTab() {
  return useSyncExternalStore(subscribe, read);
}

export const go = (tab) => {
  location.hash = "#" + tab;
};
