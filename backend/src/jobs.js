/*
 * The work the bot does for an account: sync its server, set its profile,
 * create channels, build drafts, post approved ones and send DMs. Each job is
 * recorded in the account's `requests` collection so the UI can show progress.
 * Also runs the schedule (see startScheduler).
 */
import { store } from "./store.js";
import { discord } from "./discord.js";
import { AUTO_NAMES, BUILD } from "./drafts.js";
import { SHOPS, rangeStat } from "./sampleData.js";
import { addDays, todayUTC, ymd } from "./dates.js";

const now = () => new Date().toISOString();
const fail = (message, status = 400, code = "bad_request") => Object.assign(new Error(message), { status, code });
const ID_RE = /^[A-Za-z0-9]+$/;
const POSTED_REACTIONS = ["🔥", "🤍", "🚀", "📈"];

const workspace = (ns) => store.get(ns, "workspace/main") || {};
export const cfgOf = (ns, gid) => store.get(ns, "config/" + gid) || {};
export const autosOf = (ns, gid) => store.get(ns, "automations/" + gid)?.items || {};
export const obOf = (ns, gid) => ({
  welcome: "Hey {first_name}, welcome to {server}! 👋 A few quick questions so we can set you up.",
  questions: ["What’s your TikTok handle?", "What kind of content do you usually make?", "How many videos can you post a week?", "What’s the best way for our team to reach you? (WhatsApp or email)"],
  ...(store.get(ns, "onboarding/" + gid) || {}),
});

/** Post a note in the moderators' channel. Never throws: a missing mod channel must not break the work. */
export async function tellMods(ns, gid, text, opts) {
  const mod = cfgOf(ns, gid).modChannel;
  if (!mod) return null;
  try {
    return await discord.send(mod, text, opts);
  } catch {
    return null;
  }
}

/** The server this account chose in setup. Jobs only ever act on this one. */
function ownGuild(ns) {
  const gid = workspace(ns).guildId;
  const g = gid && store.get(ns, "discord/" + gid);
  if (!g) throw fail("Pick your Discord server first.", 409, "no_guild");
  return g;
}

/** True when another account already uses this server. */
export function claimedByOther(ns, guildId) {
  return store.workspaces().some((w) => w.ns !== ns && w.ws.guildId === guildId);
}

async function refreshGuild(ns, guildId, withMembers) {
  const g = await discord.guild(guildId);
  store.set(ns, "discord/" + guildId, g);
  if (withMembers) {
    const list = await discord.members(guildId, g.roleNames);
    const prev = store.get(ns, "members/" + guildId);
    // Keep people who left (their history still counts), and note when listing isn't allowed.
    const gone = (prev?.list || []).filter((m) => m.left || (list && !list.some((x) => x.id === m.id))).map((m) => ({ ...m, left: m.left || ymd(new Date()) }));
    store.set(ns, "members/" + guildId, { guild: guildId, list: list ? [...list, ...gone.filter((m) => !list.some((x) => x.id === m.id))] : prev?.list || [], allowed: !!list, syncedAt: now() });
    // Earlier versions filled analytics with sample activity; only what the bot counted itself stays.
    for (const d of store.list(ns, "activity", (x) => x.guild === guildId && !x.live)) store.remove(ns, "activity/" + d.id);
    for (const d of store.list(ns, "onboarding_responses")) store.remove(ns, "onboarding_responses/" + d.id);
  }
  return g;
}

const draftText = (d) => (d.messages?.length ? d.messages.map((m) => m.text).join("\n\n") : d.text || "");

/** Show a new draft to the moderators, who can approve it there with a reaction. */
async function announceDraft(ns, g, id) {
  const d = store.get(ns, "drafts/" + id);
  const cfg = cfgOf(ns, g.guildId);
  if (!d || !cfg.modChannel || cfg.notifyDraft === false) return;
  const where = d.channel === "dm" ? "a DM to each creator" : `<#${d.channel}>`;
  const body = draftText(d);
  const msg = await tellMods(ns, g.guildId, `📝 **${d.name}** is ready for review. It will go to ${where}.\n\n${body.slice(0, 1500).replace(/@(here|everyone)/g, "@​$1")}${body.length > 1500 ? "…" : ""}\n\n-# React ✅ to approve and post it, ❌ to reject. You can edit it first in the dashboard under Approvals.`);
  if (!msg) return;
  await discord.react(cfg.modChannel, msg.id, ["✅", "❌"]);
  store.update(ns, "drafts/" + id, { modMessageId: msg.id });
}

const HANDLERS = {
  /** Look up every server the bot is in and store the ones this account may use. */
  async sync(ns) {
    const mine = workspace(ns).guildId;
    const seen = new Set();
    const guilds = [];
    for (const { id } of await discord.guilds()) {
      if (claimedByOther(ns, id)) continue;
      const g = await refreshGuild(ns, id, id === mine);
      seen.add(id);
      guilds.push({ guildId: g.guildId, guildName: g.guildName, channels: g.channels.length });
    }
    for (const d of store.list(ns, "discord")) if (!seen.has(d.id)) store.remove(ns, "discord/" + d.id);
    return { guilds };
  },

  /** Apply the bot's name and picture in the chosen server. */
  async profile(ns, { name, avatar }) {
    const g = ownGuild(ns);
    let warning = null;
    try {
      await discord.setProfile(g.guildId, { name, avatar });
    } catch (e) {
      if (e.code === "not_configured" || e.code === "bad_token") throw e;
      warning = "Couldn’t rename the bot in Discord: " + e.message;
    }
    await refreshGuild(ns, g.guildId, true);
    return { warning };
  },

  /** Community builder: create the missing channels with their permissions. */
  async create_channels(ns, { channels }) {
    const g = ownGuild(ns);
    if (!Array.isArray(channels) || !channels.length || channels.length > 40) throw fail("Nothing to create.");
    const todo = channels.map((c) => ({
      name: String(c.name || "").slice(0, 90), category: String(c.category || "").slice(0, 90), perm: String(c.perm || "everyone"),
    })).filter((c) => c.name);
    let created;
    try {
      created = await discord.createChannels(g.guildId, todo);
    } catch (e) {
      if (e.status === 403) throw fail("The bot isn’t allowed to create channels. Give its role Manage Channels in Server Settings → Roles, then try again.", 403, "missing_permission");
      throw e;
    }
    return { created, guild: await refreshGuild(ns, g.guildId) };
  },

  /** The allowlist is enforced here: the bot only posts to channels of the chosen server. */
  async allowlist(ns) {
    const g = ownGuild(ns);
    store.update(ns, "allowlist/" + g.guildId, { syncedAt: now() });
  },

  /**
   * Build a draft. `automation` is a built-in key, or `custom` is the id of a custom automation.
   * `test` sends it to the moderators' channel instead of its own.
   */
  async draft(ns, { automation, custom, test, replaces, source, videoId }) {
    const g = ownGuild(ns);
    const cfg = cfgOf(ns, g.guildId);
    let name, messages, channel, auto;
    if (custom) {
      const c = ID_RE.test(custom) && store.get(ns, "custom/" + custom);
      if (!c) throw fail("Unknown automation.", 404);
      const ping = c.channel === "dm" || !c.mention || c.mention === "none" ? "" : c.mention + " ";
      const text = String(c.text || "").replace(/^@(here|everyone)\s*/i, "");
      [name, messages, channel, auto] = [c.name, [{ text: ping + text }], c.channel, "custom:" + custom];
    } else {
      if (!BUILD[automation]) throw fail("This automation can’t build drafts yet.");
      const s = autosOf(ns, g.guildId)[automation] || {};
      const shop = SHOPS.find((x) => x.id === workspace(ns).shopId) || SHOPS[0];
      [name, messages, channel, auto] = [AUTO_NAMES[automation], BUILD[automation](shop, s, { videoId }), s.channel, automation];
    }
    const target = test ? cfg.modChannel : channel;
    const id = store.add(ns, "drafts", {
      guild: g.guildId, automation: auto, name,
      channel: target || "", channelName: target === "dm" ? "Direct message" : g.channels.find((c) => c.id === target)?.name || "",
      test: !!test, source: source || (test ? "test" : "schedule"), replaces: ID_RE.test(replaces || "") ? replaces : null,
      messages, text: messages.map((m) => m.text).join("\n\n"),
      status: "pending", createdAt: now(), history: [{ at: now(), what: "Draft built" }],
    });
    if (ID_RE.test(replaces || "") && store.get(ns, "drafts/" + replaces)?.status === "pending") store.update(ns, "drafts/" + replaces, { status: "replaced" });
    if (!test) await announceDraft(ns, g, id);
    return { draftId: id };
  },

  async post(ns, { draftId, by }) {
    if (!ID_RE.test(draftId || "")) throw fail("Unknown draft.");
    const path = "drafts/" + draftId;
    const d = store.get(ns, path);
    if (!d) throw fail("Unknown draft.", 404);
    if (d.status !== "pending") return { posted: d.status === "posted" };
    const g = ownGuild(ns);
    const hist = (what) => [...(d.history || []), { at: now(), what }];
    const back = (error) => {
      store.update(ns, path, { status: "pending", error, history: hist("Post failed") });
      return { posted: false, error };
    };
    const messages = d.messages?.length ? d.messages : [{ text: d.text }];
    const who = String(by || "You").slice(0, 80);
    store.update(ns, path, { status: "posting" });

    if (d.channel === "dm") {
      // One DM per member the bot already has a thread with; {first_name} is filled per person.
      const threads = store.list(ns, "dms", (t) => t.guild === g.guildId && t.status !== "closed");
      if (!threads.length) return back("No creators to DM yet. The bot can DM members once they’ve been welcomed.");
      let sent = 0;
      for (const { id, ...t } of threads) {
        const text = messages.map((m) => m.text).join("\n\n").replace(/\{(first_name|name)\}/g, t.name.split(/\s+/)[0]);
        try {
          await discord.dm(id, text);
          store.set(ns, "dms/" + id, { ...t, msgs: [...t.msgs, { from: "bot", text, at: now() }], updatedAt: now() });
          sent++;
        } catch { /* this member closed their DMs */ }
      }
      if (!sent) return back("None of the DMs could be delivered.");
      store.update(ns, path, { status: "posted", error: null, by: who, postedAt: now(), history: hist(`Sent to ${sent} creator${sent === 1 ? "" : "s"} by DM`) });
    } else {
      const ch = g.channels.find((c) => c.id === d.channel);
      if (!ch) return back("This draft has no channel in your server. Pick one in Automations, then build it again.");
      try {
        let last = null;
        for (const m of messages) last = (await discord.send(ch.id, m.text)) || last;
        if (last && !d.test) await discord.react(ch.id, last.id, POSTED_REACTIONS);
        store.update(ns, path, {
          status: "posted", error: null, by: who, postedAt: now(),
          messageUrl: last ? `https://discord.com/channels/${g.guildId}/${ch.id}/${last.id}` : null,
          history: hist(`Posted to #${ch.name}`),
        });
      } catch (e) {
        return back(e.status === 403 ? `The bot can’t post in #${ch.name}. Give it View Channel and Send Messages there, then try again.` : e.message);
      }
    }
    if (d.modMessageId) await tellMods(ns, g.guildId, `✅ Posted by ${who}.`, { replyTo: d.modMessageId });
    return { posted: true };
  },

  async reject(ns, { draftId, by }) {
    if (!ID_RE.test(draftId || "")) throw fail("Unknown draft.");
    const d = store.get(ns, "drafts/" + draftId);
    if (!d || d.status !== "pending") return;
    const who = String(by || "You").slice(0, 80);
    store.update(ns, "drafts/" + draftId, { status: "rejected", by: who, history: [...(d.history || []), { at: now(), what: "Rejected" }] });
    if (d.modMessageId) await tellMods(ns, d.guild, `❌ Rejected by ${who}.`, { replyTo: d.modMessageId });
  },

  /** Show a draft to the moderators without posting it anywhere else. */
  async test(ns, { draftId }) {
    const g = ownGuild(ns);
    const d = ID_RE.test(draftId || "") && store.get(ns, "drafts/" + draftId);
    if (!d) throw fail("Unknown draft.", 404);
    if (!cfgOf(ns, g.guildId).modChannel) throw fail("Pick an approvals channel in Settings → Channels first.", 409, "no_mod_channel");
    const sent = await tellMods(ns, g.guildId, `🧪 **Test: ${d.name}**\n\n${draftText(d).replace(/@(here|everyone)/g, "@​$1")}`);
    if (!sent) throw fail("The bot can’t post in your approvals channel. Give it View Channel and Send Messages there.", 403, "missing_permission");
  },

  /** Reply to a creator's DM as the bot. */
  async dm(ns, { userId, text }) {
    const g = ownGuild(ns);
    text = String(text || "").trim().slice(0, 1900);
    const t = /^\d+$/.test(userId || "") && store.get(ns, "dms/" + userId);
    if (!t || t.guild !== g.guildId) throw fail("Unknown conversation.", 404);
    if (!text) throw fail("Write a message first.");
    try {
      const sent = await discord.dm(userId, text);
      store.set(ns, "dms/" + userId, {
        ...t, channelId: sent.channelId, msgs: [...t.msgs, { from: "bot", text, at: now(), by: "team" }],
        status: t.status === "needs" || t.status === "closed" ? "done" : t.status, unread: false, error: null, updatedAt: now(),
      });
    } catch (e) {
      throw fail(e.code === 50007 ? "This member doesn’t accept DMs from the bot." : e.message, 409, "dm_failed");
    }
  },

  async dm_read(ns, { userId }) {
    const t = /^\d+$/.test(userId || "") && store.get(ns, "dms/" + userId);
    if (t?.unread) store.set(ns, "dms/" + userId, { ...t, unread: false });
  },

  /** Welcome a member by DM now (used for people who joined before the bot was listening). */
  async welcome(ns, { userId }) {
    const g = ownGuild(ns);
    const m = store.get(ns, "members/" + g.guildId)?.list.find((x) => x.id === userId && !x.bot);
    if (!m) throw fail("Unknown member.", 404);
    const { startOnboarding } = await import("./bot.js");
    await startOnboarding(ns, g, m);
    const t = store.get(ns, "dms/" + userId);
    if (t?.status === "closed") throw fail(t.error || "The DM couldn’t be delivered.", 409, "dm_failed");
  },
};

/**
 * Start a job. Returns `{ id, done }`; `done` resolves to `{ status, result?, error?, code? }`
 * and never rejects.
 */
export function startJob(ns, type, payload = {}) {
  const handler = HANDLERS[type];
  if (!handler) throw fail("Unknown request type.");
  const cutoff = new Date(Date.now() - 36e5).toISOString();
  for (const r of store.list(ns, "requests")) if (r.status !== "working" && r.at < cutoff) store.remove(ns, "requests/" + r.id);
  // Only small fields are recorded; pictures, message text and channel lists stay out of the log.
  const { automation = null, custom = null, test = false, draftId = null } = payload;
  const path = "requests/" + store.add(ns, "requests", {
    type, automation: automation || (custom ? "custom:" + custom : null), test: !!test, draftId, guild: workspace(ns).guildId || "", at: now(), status: "working",
  });
  const done = (async () => {
    try {
      const result = (await handler(ns, payload)) || {};
      store.update(ns, path, { status: "done", doneAt: now() });
      return { status: "done", result };
    } catch (e) {
      if (!e.status) console.error(`[job ${type}]`, e);
      store.update(ns, path, { status: "failed", error: e.message });
      return { status: "failed", error: e.message, code: e.code || "error" };
    }
  })();
  return { id: path.slice(9), done };
}

/* ---------- schedule: runs each automation at its day and time, in the workspace's time zone ---------- */
const SCHEDULED = { viral_hooks: true, winning_content: true, leaderboard: true, wins: "daily" };
const clocks = new Map();
function clockIn(zone) {
  if (!clocks.has(zone)) {
    try {
      clocks.set(zone, new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" }));
    } catch {
      return clockIn("America/New_York");
    }
  }
  const p = Object.fromEntries(clocks.get(zone).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { today: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, weekday: p.weekday };
}

async function weeklySummary(ns, gid) {
  const shop = SHOPS.find((x) => x.id === workspace(ns).shopId) || SHOPS[0];
  const to = ymd(addDays(todayUTC(), -1)), from = ymd(addDays(todayUTC(), -7));
  const days = store.list(ns, "activity", (d) => d.guild === gid && d.date >= from && d.date <= to);
  const msgs = days.reduce((n, d) => n + Object.values(d.users || {}).reduce((a, u) => a + (u.m || 0), 0), 0);
  const joined = (store.get(ns, "members/" + gid)?.list || []).filter((m) => m.joined >= from && m.joined <= to && !m.bot).length;
  const posted = store.list(ns, "drafts", (d) => d.guild === gid && d.status === "posted" && (d.postedAt || "") >= from).length;
  const sym = shop.region === "uk" ? "£" : "$";
  await tellMods(ns, gid, `📊 **Last week in numbers** (${from} to ${to})\n• GMV: ${sym}${Math.round(rangeStat(shop.id, "total_gmv", from, to)).toLocaleString("en-US")} (sample CRM data)\n• New members: ${joined}\n• Messages counted: ${msgs}\n• Posts the bot published: ${posted}`);
}

async function tick() {
  for (const { ns, ws } of store.workspaces()) {
    if (!ws.done || !ws.guildId) continue;
    const gid = ws.guildId;
    const cfg = cfgOf(ns, gid);
    const { today, time, weekday } = clockIn(cfg.timezone || "America/New_York");
    const ran = store.get(ns, "schedule/" + gid) || {};
    const claim = (key) => {
      if (ran[key] === today) return false;
      ran[key] = today;
      store.set(ns, "schedule/" + gid, ran);
      return true;
    };
    const run = async (payload, approve) => {
      const built = await startJob(ns, "draft", { ...payload, source: "schedule" }).done;
      if (built.status === "done" && !approve) await startJob(ns, "post", { draftId: built.result.draftId, by: "Schedule" }).done;
    };
    const items = autosOf(ns, gid);
    for (const [key, kind] of Object.entries(SCHEDULED)) {
      const s = items[key];
      if (!s?.enabled || !s.channel || s.time !== time) continue;
      if (kind !== "daily" && !(s.days || []).includes(weekday)) continue;
      if (claim(key)) await run({ automation: key }, s.mode !== "auto");
    }
    for (const c of store.list(ns, "custom", (x) => x.guild === gid && x.on)) {
      if (c.time !== time || !(c.days || []).includes(weekday) || !c.channel) continue;
      if (claim("custom:" + c.id)) await run({ custom: c.id }, c.approval !== false);
    }
    if (cfg.digest && weekday === "Mon" && time === "09:00" && claim("digest")) await weeklySummary(ns, gid);
  }
}

export function startScheduler() {
  setInterval(() => tick().catch((e) => console.error("[schedule]", e)), 20_000).unref();
  setInterval(() => import("./bot.js").then((b) => b.sendReminders()).catch((e) => console.error("[reminders]", e)), 10 * 60_000).unref();
}
