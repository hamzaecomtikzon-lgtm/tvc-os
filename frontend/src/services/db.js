/*
 * The account's document store, with Firestore-like paths ("collection/docId").
 * Documents live on the server; this module keeps a live copy in memory so the
 * UI can read synchronously, sends writes to the API, and applies changes pushed
 * by the server (other tabs, and the bot's work) as they happen.
 */
import { useSyncExternalStore } from "react";
import { CLIENT_ID, api } from "./api.js";

let data = {};
let version = 0;
let account = ""; // id of the signed-in user whose documents are loaded
let ready = Promise.resolve();
let stream = null;
let writes = Promise.resolve(); // writes go out one at a time, in order
const listeners = new Set();

function emit() {
  version++;
  listeners.forEach((l) => l());
}

async function load(id) {
  const { docs } = await api("GET", "/docs");
  if (id !== account) return;
  data = docs;
  emit();
}

function listen(id) {
  stream = new EventSource("/api/events?cid=" + CLIENT_ID);
  let dropped = false;
  stream.onmessage = (e) => {
    const { path, doc } = JSON.parse(e.data);
    if (path == null) data = {};
    else if (doc == null) delete data[path];
    else data[path] = doc;
    emit();
  };
  // After a dropped connection, changes may have been missed: read everything again.
  stream.onerror = () => { dropped = true; };
  stream.onopen = () => {
    if (dropped) load(id).catch(() => {});
    dropped = false;
  };
}

/** Send a write after the ones before it. Rejects if the server refuses it. */
function push(method, path, body) {
  const run = writes.then(() => api(method, path, body));
  writes = run.catch(() => {});
  return run;
}

const isChild = (path, col) => path.startsWith(col + "/") && !path.slice(col.length + 1).includes("/");
const url = (path) => "/docs/" + path.split("/").map(encodeURIComponent).join("/");

export const db = {
  /** Load one account's documents and keep them live (or close the store when `id` is empty). */
  open(id = "") {
    if (id === account) return ready;
    account = id;
    stream?.close();
    stream = null;
    data = {};
    emit();
    if (!id) return (ready = Promise.resolve());
    listen(id);
    return (ready = load(id));
  },
  /** Resolves when the open account's documents have loaded. Rejects if they couldn't be. */
  ready: () => ready,
  /** Resolves when every write made so far has reached the server. */
  flushed: () => writes,
  /** Read one document (a copy) or null. */
  get(path) {
    return data[path] ? structuredClone(data[path]) : null;
  },
  /** Documents in a collection as read-only snapshots `{ id, ...fields }`. */
  list(col, where) {
    const out = [];
    for (const [k, v] of Object.entries(data)) {
      if (isChild(k, col) && (!where || where(v))) out.push({ id: k.slice(col.length + 1), ...v });
    }
    return out;
  },
  async set(path, doc) {
    data[path] = structuredClone(doc);
    emit();
    await push("PUT", url(path), { doc });
  },
  async update(path, patch) {
    if (!data[path]) throw Object.assign(new Error("Document not found"), { code: "not_found" });
    await db.set(path, { ...data[path], ...patch });
  },
  async remove(path) {
    delete data[path];
    emit();
    await push("DELETE", url(path));
  },
  count(col) {
    let n = 0;
    for (const k in data) if (isChild(k, col)) n++;
    return n;
  },
  /** Delete every document of the account. */
  async reset() {
    data = {};
    emit();
    await push("DELETE", "/docs");
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  version: () => version,
};

/** Re-render whenever the store changes; returns a version number for memo deps. */
export function useDb() {
  return useSyncExternalStore(db.subscribe, db.version);
}
