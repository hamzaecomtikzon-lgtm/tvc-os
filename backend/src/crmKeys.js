/*
 * Each workspace's own CRM API key, encrypted at rest (AES-256-GCM).
 *
 * Keys live in their own table, never in the `docs` store: every doc is sent to the
 * browser by GET /api/docs, and a key must never leave the server once saved.
 *
 * The encryption key comes from KREO_SECRET_KEY (any long random string). Without it, a
 * random one is generated once into data/.kreo-secret so local runs work; set
 * KREO_SECRET_KEY in production so the database alone can't reveal the keys. Changing
 * it makes saved keys unreadable, and those workspaces fall back to sample data until
 * their owner reconnects.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DB_FILE, sql } from "./store.js";

sql.exec(`
  CREATE TABLE IF NOT EXISTS crm_keys (
    ns TEXT PRIMARY KEY, provider TEXT NOT NULL, enc TEXT NOT NULL, last4 TEXT NOT NULL,
    shops INTEGER NOT NULL DEFAULT 0, connected_at TEXT NOT NULL
  );
`);

function secret() {
  if (process.env.KREO_SECRET_KEY) return createHash("sha256").update(process.env.KREO_SECRET_KEY).digest();
  const file = join(dirname(DB_FILE), ".kreo-secret");
  if (!existsSync(file)) {
    writeFileSync(file, randomBytes(32).toString("base64"), { mode: 0o600 });
    console.warn(`[crm keys] KREO_SECRET_KEY isn't set; generated one in ${file}. Set KREO_SECRET_KEY in production.`);
  }
  return createHash("sha256").update(readFileSync(file, "utf8").trim()).digest();
}
const KEY = secret();
/** A separate key for another purpose (e.g. signing links), derived from the same secret. */
export const deriveKey = (label) => createHash("sha256").update(KEY).update("|" + label).digest();

function encrypt(text) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", KEY, iv);
  const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
}
function decrypt(enc) {
  const [iv, tag, body] = enc.split(".").map((s) => Buffer.from(s, "base64"));
  const d = createDecipheriv("aes-256-gcm", KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString("utf8");
}

const q = {
  get: sql.prepare("SELECT provider, enc, last4, shops, connected_at FROM crm_keys WHERE ns = ?"),
  put: sql.prepare(`INSERT INTO crm_keys (ns, provider, enc, last4, shops, connected_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (ns) DO UPDATE SET provider = excluded.provider, enc = excluded.enc, last4 = excluded.last4, shops = excluded.shops, connected_at = excluded.connected_at`),
  del: sql.prepare("DELETE FROM crm_keys WHERE ns = ?"),
};

const plain = new Map(); // ns → decrypted key (null when it can't be read), so requests don't decrypt every time

export const crmKeys = {
  /** The workspace's decrypted key for a provider, or null. */
  key(ns, provider = "cruva") {
    if (!ns) return null;
    if (!plain.has(ns)) {
      const row = q.get.get(ns);
      let k = null;
      if (row) {
        try { k = { provider: row.provider, key: decrypt(row.enc) }; } catch { console.error(`[crm keys] couldn't decrypt the key of workspace ${ns}; was KREO_SECRET_KEY changed?`); }
      }
      plain.set(ns, k);
    }
    const k = plain.get(ns);
    return k && k.provider === provider ? k.key : null;
  },
  /** What the browser may know about the connection (never the key itself). */
  info(ns) {
    const row = ns && q.get.get(ns);
    if (!row) return null;
    return { provider: row.provider, last4: row.last4, shops: row.shops, connectedAt: row.connected_at, readable: crmKeys.key(ns, row.provider) != null };
  },
  save(ns, provider, key, shops = 0) {
    q.put.run(ns, provider, encrypt(key), key.slice(-4), shops, new Date().toISOString());
    plain.delete(ns);
  },
  remove(ns) {
    q.del.run(ns);
    plain.delete(ns);
  },
};
