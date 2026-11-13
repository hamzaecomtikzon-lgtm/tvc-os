/*
 * Requests to the bot. The server does the work in Discord (sync the server,
 * create channels, build a draft, post it) and writes the results back to the
 * store, where they show up live.
 */
import { api } from "./api.js";
import { db } from "./db.js";

async function send(type, payload, wait) {
  await db.flushed(); // the job must see what we just saved
  return api("POST", "/requests", { type, payload, wait });
}

/** Start a request and return right away. Resolves true when the server accepted it. */
export async function ask(type, payload = {}) {
  try {
    await send(type, payload, false);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a request and wait for it. Resolves `{ ok, result, error, code }`;
 * `error` is a sentence that can be shown as is.
 */
export async function askWait(type, payload = {}) {
  try {
    const r = await send(type, payload, true);
    return r.status === "done" ? { ok: true, result: r.result || {} } : { ok: false, error: r.error, code: r.code };
  } catch (e) {
    return { ok: false, error: e.message, code: e.code };
  }
}
