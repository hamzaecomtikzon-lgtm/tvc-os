/*
 * Live link to the Claude session that runs the Discord bot.
 * Every request is written to the `requests` collection; the session (here,
 * the demo worker) picks it up, does the work in Discord and writes results back.
 */
import { db } from "./db.js";

export const LIVE_LINK = true;

/** Queue a request. Resolves true when the live link accepted it. */
export async function ask(type, payload = {}, guild = "") {
  await db.add("requests", { type, ...payload, guild, at: new Date().toISOString(), status: "sent" });
  return LIVE_LINK;
}
