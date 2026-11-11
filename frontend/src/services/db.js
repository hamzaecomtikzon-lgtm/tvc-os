/*
 * A small document store with Firestore-like paths ("collection/docId"),
 * persisted to localStorage and shared live across browser tabs.
 * Swap this module for a real backend client to go to production; the UI only
 * uses get / list / set / update / remove / add / setMany and useDb().
 */
import { useSyncExternalStore } from "react";

const PREFIX = "tvc-creator-os.v2.";
// Large, write-rarely collections live in their own bucket so ordinary saves stay cheap.
const bucketOf = (path) => (path.startsWith("activity/") ? "activity" : "main");

let data = {};
let version = 0;
const dirty = new Set();
const listeners = new Set();

function load() {
  data = {};
  for (const b of ["main", "activity"]) {
    try {
      Object.assign(data, JSON.parse(localStorage.getItem(PREFIX + b) || "{}"));
    } catch {
      /* corrupt or unavailable storage: start empty */
    }
  }
}
load();

function emit() {
  version++;
  listeners.forEach((l) => l());
}

function commit() {
  let failure = null;
  for (const b of dirty) {
    const slice = {};
    for (const [k, v] of Object.entries(data)) if (bucketOf(k) === b) slice[k] = v;
    try {
      localStorage.setItem(PREFIX + b, JSON.stringify(slice));
    } catch {
      failure = Object.assign(new Error("Storage is full"), { code: "quota_exceeded" });
    }
  }
  dirty.clear();
  emit();
  if (failure) throw failure;
}

function touch(path) {
  dirty.add(bucketOf(path));
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key && e.key.startsWith(PREFIX)) {
      load();
      emit();
    }
  });
}

const isChild = (path, col) => path.startsWith(col + "/") && !path.slice(col.length + 1).includes("/");
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const db = {
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
    touch(path);
    commit();
  },
  async update(path, patch) {
    if (!data[path]) throw Object.assign(new Error("Document not found"), { code: "not_found" });
    data[path] = { ...data[path], ...structuredClone(patch) };
    touch(path);
    commit();
  },
  async remove(path) {
    delete data[path];
    touch(path);
    commit();
  },
  async add(col, doc) {
    const id = newId();
    data[col + "/" + id] = structuredClone(doc);
    touch(col + "/" + id);
    commit();
    return id;
  },
  async setMany(entries) {
    for (const { path, data: d } of entries) {
      data[path] = d;
      touch(path);
    }
    commit();
  },
  count(col) {
    let n = 0;
    for (const k in data) if (isChild(k, col)) n++;
    return n;
  },
  reset() {
    data = {};
    dirty.add("main");
    dirty.add("activity");
    commit();
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
