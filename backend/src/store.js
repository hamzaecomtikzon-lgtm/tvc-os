/*
 * SQLite storage: accounts, sessions, and a per-account document store with
 * Firestore-like paths ("collection/docId"). Every document change is announced
 * to subscribers so open browser tabs stay live (see /api/events).
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const file = process.env.DATABASE_FILE || fileURLToPath(new URL("../data/kreo.db", import.meta.url));
mkdirSync(dirname(file), { recursive: true });

export const sql = new DatabaseSync(file);
sql.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, brand TEXT NOT NULL,
    provider TEXT NOT NULL, salt TEXT, hash TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS docs (
    ns TEXT NOT NULL, path TEXT NOT NULL, doc TEXT NOT NULL, PRIMARY KEY (ns, path)
  );
  CREATE TABLE IF NOT EXISTS invites (
    email TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL
  );
`);

// Team members share their owner's workspace: users.workspace_id is the owner's id (NULL for owners).
const userCols = sql.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (!userCols.includes("workspace_id")) sql.exec("ALTER TABLE users ADD COLUMN workspace_id TEXT");
if (!userCols.includes("role")) sql.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'Owner'");

const q = {
  at: sql.prepare("SELECT ns, doc FROM docs WHERE path = ?"),
  owner: sql.prepare("SELECT id, name, brand, email, created_at FROM users WHERE id = ?"),
  get: sql.prepare("SELECT doc FROM docs WHERE ns = ? AND path = ?"),
  all: sql.prepare("SELECT path, doc FROM docs WHERE ns = ?"),
  col: sql.prepare("SELECT path, doc FROM docs WHERE ns = ? AND path >= ? AND path < ?"),
  put: sql.prepare("INSERT INTO docs (ns, path, doc) VALUES (?, ?, ?) ON CONFLICT (ns, path) DO UPDATE SET doc = excluded.doc"),
  del: sql.prepare("DELETE FROM docs WHERE ns = ? AND path = ?"),
  clear: sql.prepare("DELETE FROM docs WHERE ns = ?"),
  owners: sql.prepare("SELECT ns, doc FROM docs WHERE path = 'workspace/main'"),
};

const listeners = new Set();
const emit = (ns, path, doc, origin) => listeners.forEach((l) => l(ns, path, doc, origin));
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const store = {
  get(ns, path) {
    const row = q.get.get(ns, path);
    return row ? JSON.parse(row.doc) : null;
  },
  /** Every document of an account as `{ path: doc }`. */
  all(ns) {
    const out = {};
    for (const r of q.all.all(ns)) out[r.path] = JSON.parse(r.doc);
    return out;
  },
  /** Documents in a collection as `{ id, ...fields }`. */
  list(ns, col, where) {
    const out = [];
    // "0" is the character after "/", so this range is exactly the collection's children.
    for (const r of q.col.all(ns, col + "/", col + "0")) {
      const doc = JSON.parse(r.doc);
      if (!where || where(doc)) out.push({ id: r.path.slice(col.length + 1), ...doc });
    }
    return out;
  },
  /** `origin` is the browser tab that made the change; it isn't echoed back to it. */
  set(ns, path, doc, origin) {
    q.put.run(ns, path, JSON.stringify(doc));
    emit(ns, path, doc, origin);
  },
  update(ns, path, patch) {
    const cur = store.get(ns, path);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    store.set(ns, path, next);
    return next;
  },
  remove(ns, path, origin) {
    q.del.run(ns, path);
    emit(ns, path, null, origin);
  },
  add(ns, col, doc) {
    const id = newId();
    store.set(ns, col + "/" + id, doc);
    return id;
  },
  clear(ns) {
    q.clear.run(ns);
    emit(ns, null, null);
  },
  /** The account that owns a workspace. */
  owner(ns) {
    return q.owner.get(ns) || null;
  },
  /** The same path in every workspace: `[{ ns, doc }]`. */
  everywhere(path) {
    return q.at.all(path).map((r) => ({ ns: r.ns, doc: JSON.parse(r.doc) }));
  },
  /** Every account's workspace document: `[{ ns, ws }]`. */
  workspaces() {
    return q.owners.all().map((r) => ({ ns: r.ns, ws: JSON.parse(r.doc) }));
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
