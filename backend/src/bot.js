/*
 * What the bot does with live Discord events: counts community activity,
 * welcomes new members by DM and records their answers, keeps the DM inbox,
 * lets moderators approve drafts with a reaction or a typed reply (now or spaced out), and answers the general chat.
 */
import { store } from "./store.js";
import { discord, memberRow } from "./discord.js";
import { ai } from "./ai.js";
import { ymd } from "./dates.js";
import { approveDrafts, autosOf, cfgOf, obOf, reviewable, startJob, tellMods } from "./jobs.js";
import * as audit from "./audit.js";

const now = () => new Date().toISOString();
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;
const first = (name) => String(name || "there").trim().split(/\s+/)[0];

/**
 * The TikTok handle in a reply, or "" when the reply doesn't contain one: an @name, a tiktok.com link,
 * or a reply that is just a handle ("mia.beauty"). "I don't have one yet" is not a handle.
 */
// Replies that mean "I don't have a TikTok", not a handle.
const NO_HANDLE = /^(none|no|nope|nah|na|n\/a|idk|nothing|not yet|no tiktok|i don.?t have (one|it|a tiktok)( yet)?|dont have( one)?|skip|later|-)[.!]?$/i;

export function handleIn(text) {
  if (NO_HANDLE.test(String(text || "").trim())) return "";
  const t = String(text || "").trim();
  if (/^(yes|yeah|yep|ok|okay|sure|hi|hey|hello|thanks|thank you|ty)[.!]*$/i.test(t)) return "";
  const raw = t.match(/tiktok\.com\/@([a-z0-9._]{2,24})/i)?.[1] || t.match(/(?:^|\s)@([a-z0-9._]{2,24})/i)?.[1]
    || t.match(/(?:handle|tiktok|user ?name)\s*(?:is|:|=|-)\s*@?([a-z0-9._]{2,24})/i)?.[1]
    || (/^@?[a-z0-9._]{2,24}[.!]?$/i.test(t) ? t : "");
  const h = raw.replace(/^@/, "").replace(/[!]$/, "").replace(/\.+$/, "").toLowerCase();
  return /^[a-z0-9._]{2,24}$/.test(h) && /[a-z]/.test(h) ? h : "";
}

/* ---------- which account a server belongs to ---------- */
let owners = null, ownersAt = 0;
function nsOf(guildId) {
  if (!owners || Date.now() - ownersAt > 5000) {
    owners = new Map(store.workspaces().filter((w) => w.ws.guildId).map((w) => [w.ws.guildId, w.ns]));
    ownersAt = Date.now();
  }
  return owners.get(guildId) || null;
}
const guildOf = (ns, gid) => store.get(ns, "discord/" + gid);

/* ---------- activity counters (written every few seconds, not on every message) ---------- */
const pending = new Map(); // path → { ns, doc }
function activity(ns, gid, change) {
  const date = ymd(new Date());
  const path = `activity/${gid}_${date}`;
  const hit = pending.get(ns + "|" + path);
  const doc = hit?.doc || store.get(ns, path) || { guild: gid, date, live: true, users: {}, channels: {}, replyTimes: [] };
  change(doc);
  pending.set(ns + "|" + path, { ns, path, doc });
}
setInterval(() => {
  for (const { ns, path, doc } of pending.values()) store.set(ns, path, doc);
  pending.clear();
}, 4000).unref();

function userRow(doc, g, member, user) {
  const u = doc.users[user.id] || (doc.users[user.id] = { n: "", m: 0, rr: 0, pr: 0, rg: 0, v: 0, roles: [] });
  u.n = member?.nick || user.global_name || user.username || u.n;
  if (member?.roles) u.roles = member.roles.map((r) => g.roleNames?.[r]).filter(Boolean);
  return u;
}

const lastCounted = new Map(); // guild|user → time of the last message that scored
const recent = new Map(); // channel → last few messages, for the chat manager's context
const voice = new Map(); // guild|user → time they joined a voice channel

function onGuildMessage(d) {
  const ns = nsOf(d.guild_id);
  const g = ns && guildOf(ns, d.guild_id);
  if (!g || d.author?.bot || d.webhook_id) return;
  const sc = store.get(ns, "scoring/" + d.guild_id) || {};
  const ch = g.channels.find((c) => c.id === d.channel_id);
  const key = d.guild_id + "|" + d.author.id;
  const cooled = Date.now() - (lastCounted.get(key) || 0) >= (sc.cooldown ?? 30) * 1000;
  if (cooled) lastCounted.set(key, Date.now());
  const ref = d.referenced_message;
  activity(ns, d.guild_id, (doc) => {
    const u = userRow(doc, g, d.member, d.author);
    if (cooled) u.m++;
    const c = doc.channels[d.channel_id] || (doc.channels[d.channel_id] = { name: ch?.name || "unknown", m: 0, r: 0, p: 0, top: {} });
    c.m++;
    c.top[d.author.id] = (c.top[d.author.id] || 0) + 1;
    if (ref?.author && !ref.author.bot && ref.author.id !== d.author.id) {
      c.p++;
      if (doc.users[ref.author.id]) doc.users[ref.author.id].pr++;
      else doc.users[ref.author.id] = { n: ref.author.global_name || ref.author.username, m: 0, rr: 0, pr: 1, rg: 0, v: 0, roles: [] };
      doc.replyTimes.push(Math.max(1, Math.round((Date.parse(d.timestamp) - Date.parse(ref.timestamp)) / 1000)));
    }
  });
  const log = recent.get(d.channel_id) || [];
  if (d.content) log.push({ who: d.member?.nick || d.author.global_name || d.author.username, text: d.content.slice(0, 400) });
  recent.set(d.channel_id, log.slice(-8));
  if (d.channel_id === cfgOf(ns, d.guild_id).modChannel) return modReply(ns, g, d).catch((e) => console.error("[approvals]", e.message));
  return chatManager(ns, g, d).catch((e) => console.error("[chat manager]", e.message));
}

function onReaction(d) {
  if (!d.guild_id || d.member?.user?.bot) return;
  const ns = nsOf(d.guild_id);
  const g = ns && guildOf(ns, d.guild_id);
  if (!g) return;
  activity(ns, d.guild_id, (doc) => {
    userRow(doc, g, d.member, d.member?.user || { id: d.user_id }).rg++;
    const c = doc.channels[d.channel_id];
    if (c) c.r++;
    const author = d.message_author_id;
    if (author && author !== d.user_id && doc.users[author]) doc.users[author].rr++;
  });
  return approveByReaction(ns, d);
}

function onVoice(d) {
  if (!d.guild_id || d.member?.user?.bot) return;
  const key = d.guild_id + "|" + d.user_id;
  const since = voice.get(key);
  if (since) {
    const mins = Math.round((Date.now() - since) / 60000);
    const ns = nsOf(d.guild_id);
    const g = ns && guildOf(ns, d.guild_id);
    if (g && mins > 0) activity(ns, d.guild_id, (doc) => { userRow(doc, g, d.member, d.member?.user || { id: d.user_id }).v += mins; });
    voice.delete(key);
  }
  if (d.channel_id) voice.set(key, Date.now());
}

/* ---------- approvals from the moderator channel: typed replies ---------- */
const APPROVE = /\b(a+p+r+o+v+e*d?|a+p+r+o+v+i+n+g|go ahead|ship it|lgtm|looks good|good to go|green ?light|post (it|them|all|both|those|these)|send (it|them|all|both|those|these))\b|✅|👍/i;
const YES = /^(yes|yep|yeah|yup|ok|okay|sure)\b/i;
const REJECT = /\b(skip(ped)?|reject(ed)?|scrap|cancel|don'?t (post|send)|do not (post|send))\b|❌/i;
const NO = /^(no|nope|nah)[.!]*$/i;
const NOT = /\b(not|don'?t|do not|never|wait|hold( off)?)\b/i;
const GAP = /\b(gaps?|space[ds]? (them |it )?out|spaced|spacing|apart|stagger(ed)?|spread (them |it )?out|one (at a time|by one)|between (each|them))\b/i;
const ALL = /\b(all|both|everything|every ?one|them|those|these|the rest|batch)\b/i;
const STOP = new Set("the and for with this that week weekly draft drafts from into your our approve approved post send skip reject".split(" "));

/** Minutes in "30 min", "1 hour", "an hour", "half an hour", "90m"; 0 when none is given. */
function minutesIn(text) {
  if (/half an? hour/i.test(text)) return 30;
  if (/\ban? hour\b/i.test(text)) return 60;
  const m = text.match(/(\d+(?:\.\d+)?)\s*(m|mins?|minutes?|h|hrs?|hours?)\b/i);
  return m ? Math.round(parseFloat(m[1]) * (/^h/i.test(m[2]) ? 60 : 1)) : 0;
}

/** What a moderator's message asks for: approve and/or skip (each with the words that name its drafts), and a gap. */
export function readModReply(raw) {
  const text = String(raw || "").trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  const intentOf = (t) => {
    const s = t.trim();
    if (REJECT.test(s) || NO.test(s)) return "reject";
    if (APPROVE.test(s) && !NOT.test(s.replace(/\bnot yet\b/i, ""))) return "approve";
    if (APPROVE.test(s) && /\bnot yet\b/i.test(s)) return null;
    if (YES.test(s) && words <= 6) return "approve";
    return null;
  };
  // "approve the leaderboard, skip the viral one": each part on its own. Otherwise the whole message.
  const parts = REJECT.test(text) && APPROVE.test(text) ? text.split(/[,;.\n]|\bbut\b|\band\b/i) : [text];
  const asks = parts.map((t) => ({ intent: intentOf(t), text: t.trim() })).filter((a) => a.intent);
  const gap = GAP.test(text) ? minutesIn(text) || 30 : 0;
  return { asks, gap, words };
}

/** The drafts a part of a message points at: the one replied to, ones named, "all", or the only one. */
function draftsFor(ns, gid, ask, { refDraft, gap, multi }) {
  const open = reviewable(ns, gid);
  const pool = ask.intent === "approve" ? open.filter((x) => !x.postAt) : open;
  if (refDraft && !multi) return { list: pool.some((x) => x.id === refDraft.id) ? [refDraft] : [], why: "replied" };
  const t = ask.text.toLowerCase();
  const scored = pool.map((d) => {
    const toks = String(d.name || "").toLowerCase().replace(/\([^)]*\)/g, " ").split(/[^a-z0-9#]+/).filter((w) => (w.length >= 4 || /^#\d+$/.test(w)) && !STOP.has(w));
    return { d, n: toks.filter((w) => new RegExp(`(^|[^a-z0-9])${w.replace("#", "#?")}s?([^a-z0-9]|$)`).test(t)).length };
  }).filter((x) => x.n);
  if (scored.length) {
    const top = Math.max(...scored.map((x) => x.n));
    let best = scored.filter((x) => x.n === top).map((x) => x.d);
    // Same name twice (one already approved and waiting): "skip the leaderboard" means the new one.
    if (best.length > 1 && best.some((x) => !x.postAt)) best = best.filter((x) => !x.postAt);
    if (best.length === 1 || ALL.test(t) || gap) return { list: best, why: "named" };
    return { list: [], ambiguous: best };
  }
  if (ALL.test(t) || (gap && ask.intent === "approve")) return { list: pool, why: "all" };
  if (pool.length <= 1) return { list: pool, why: "only" };
  return { list: [], ambiguous: pool };
}

const stamp = (ms) => `<t:${Math.floor(ms / 1000)}:t> (<t:${Math.floor(ms / 1000)}:R>)`;

/** A typed message in the approvals channel: "approved", "skip", "all approved but send in a gap", or change notes on a draft. */
async function modReply(ns, g, d) {
  const cfg = cfgOf(ns, g.guildId);
  if (!cfg.modChannel || cfg.modChannel !== d.channel_id || !d.content) return;
  const open = reviewable(ns, g.guildId);
  if (!open.length) return;
  const refId = d.message_reference?.message_id || d.referenced_message?.id;
  const refDraft = refId ? open.find((x) => x.modMessageId === refId || (x.modMessageIds || []).includes(refId)) : null;
  const { asks, gap, words } = readModReply(d.content);
  const by = (d.member?.nick || d.author.global_name || d.author.username || "a moderator") + " (in Discord)";
  const say = (text) => discord.send(d.channel_id, text, { replyTo: d.id }).catch(() => null);

  if (!asks.length) {
    // Notes written as a reply to a draft are change requests: kept on the draft for whoever edits it.
    if (refDraft && words >= 3) {
      store.update(ns, "drafts/" + refDraft.id, { changes: d.content.slice(0, 1000), history: [...(refDraft.history || []), { at: now(), what: `Changes asked by ${by}: ${d.content.slice(0, 200)}` }] });
      await say(`📝 Noted for **${refDraft.name}**. Edit it in the dashboard under Approvals (your note is shown there), then reply “approve” here.`);
    }
    return;
  }
  const multi = asks.length > 1;
  const done = new Set();
  const lines = [];
  for (const ask of asks) {
    const { list, ambiguous } = draftsFor(ns, g.guildId, ask, { refDraft, gap, multi });
    const todo = list.filter((x) => !done.has(x.id));
    if (!todo.length) {
      if (ambiguous?.length) await say(`Which one? ${ambiguous.map((x) => `**${x.name}**`).join(", ")} are waiting. Reply to that draft’s message, name it, or say “${ask.intent === "approve" ? "approve" : "skip"} all”.`);
      continue;
    }
    todo.forEach((x) => done.add(x.id));
    if (ask.intent === "reject") {
      for (const x of todo) await startJob(ns, "reject", { draftId: x.id, by }, audit.discordActor(by.replace(/ \(in Discord\)$/, ""))).done;
      if (todo.length > 1 || refDraft?.id !== todo[0].id) lines.push(`Skipped ${todo.map((x) => `**${x.name}**`).join(", ")}.`);
      continue;
    }
    if (!refDraft || todo.length > 1 || gap) await discord.react(d.channel_id, d.id, ["👍"]).catch(() => {});
    const plan = await approveDrafts(ns, g.guildId, todo, { by, gap });
    const later = plan.filter((p) => p.at);
    if (later.length) {
      const now_ = plan.filter((p) => !p.at).map((p) => `• **${p.draft.name}**: ${p.result?.status === "done" && p.result.result?.posted !== false ? "posted now" : "couldn’t post now, see the dashboard"}`);
      lines.push(`Got it, ${plan.length === 1 ? "it goes out" : `posting ${plan.length} approved drafts`} with a ${later[0].draft.gap || store.get(ns, "drafts/" + later[0].draft.id)?.gap || gap} min gap:\n${[...now_, ...later.map((p) => `• **${p.draft.name}**: ${stamp(p.at)}`)].join("\n")}`);
    }
  }
  if (lines.length) await say(lines.join("\n"));
}

/* ---------- approvals from the moderator channel: reactions ---------- */
async function approveByReaction(ns, d) {
  const emoji = d.emoji?.name;
  if (emoji !== "✅" && emoji !== "❌") return;
  if (cfgOf(ns, d.guild_id).modChannel !== d.channel_id) return;
  const draft = store.list(ns, "drafts", (x) => x.modMessageId === d.message_id && x.status === "pending")[0];
  if (!draft) return;
  const by = d.member?.nick || d.member?.user?.global_name || d.member?.user?.username || "a moderator";
  await startJob(ns, emoji === "✅" ? "post" : "reject", { draftId: draft.id, by: by + " (in Discord)" }, audit.discordActor(by)).done;
}

/* ---------- members ---------- */
function onMemberAdd(d) {
  const ns = nsOf(d.guild_id);
  const g = ns && guildOf(ns, d.guild_id);
  if (!g) return;
  const row = memberRow(d, g.roleNames);
  const doc = store.get(ns, "members/" + d.guild_id) || { guild: d.guild_id, list: [] };
  doc.list = [...doc.list.filter((m) => m.id !== row.id), row];
  store.set(ns, "members/" + d.guild_id, doc);
  if (row.bot) return;
  const on = autosOf(ns, d.guild_id).onboarding?.enabled !== false && cfgOf(ns, d.guild_id).dmNew !== false;
  if (on && store.get(ns, "workspace/main")?.done) {
    return startOnboarding(ns, g, row).then(() => {
      const t = store.get(ns, "dms/" + row.id);
      audit.log(ns, audit.BOT, t?.status === "closed"
        ? { category: "onboarding", action: "onboarding.welcome_failed", label: row.name, summary: `${row.name} joined the server, but the welcome DM couldn’t be delivered: ${t.error || "DMs are closed"}` }
        : { category: "onboarding", action: "onboarding.welcome", label: row.name, summary: `${row.name} joined the server. Sent them the welcome DM` });
    });
  }
}

function onMemberRemove(d) {
  const ns = nsOf(d.guild_id);
  const doc = ns && store.get(ns, "members/" + d.guild_id);
  if (!doc) return;
  doc.list = doc.list.map((m) => (m.id === d.user.id ? { ...m, left: ymd(new Date()) } : m));
  store.set(ns, "members/" + d.guild_id, doc);
}

/* ---------- onboarding and the DM inbox ---------- */
const fill = (text, member, g) => String(text)
  .replace(/\{(first_name|name)\}/g, first(member.name))
  .replace(/\{(server|brand)\}/g, g.guildName);

/** Send the welcome DM and the first question. Records the thread in `dms/<userId>`. */
export async function startOnboarding(ns, g, member) {
  const ob = obOf(ns, g.guildId);
  const text = [fill(ob.welcome, member, g), ob.questions[0]].filter(Boolean).join("\n\n");
  const thread = {
    guild: g.guildId, userId: member.id, user: member.user, name: member.name, status: "progress", step: 0,
    answers: {}, tiktok: "", wa: "", unread: false, reminded: false, startedAt: now(), updatedAt: now(), msgs: [],
  };
  try {
    const sent = await discord.dm(member.id, text);
    thread.channelId = sent.channelId;
    thread.msgs.push({ from: "bot", text, at: now() });
    if (!ob.questions.length) thread.status = "done";
  } catch (e) {
    thread.status = "closed";
    thread.error = e.code === 50007 ? "This member doesn’t accept DMs from server members." : e.message;
  }
  store.set(ns, "dms/" + member.id, thread);
}

async function onDm(d) {
  if (d.author?.bot) return;
  // The same person can be in several workspaces' servers: the latest thread wins.
  let hit = store.everywhere("dms/" + d.author.id).sort((a, b) => (b.doc.updatedAt || "").localeCompare(a.doc.updatedAt || ""))[0];
  if (!hit) {
    // Someone the bot never welcomed wrote first: open a thread in the workspace whose server they're in.
    for (const { ns, ws } of store.workspaces()) {
      const m = ws.guildId && store.get(ns, "members/" + ws.guildId)?.list.find((x) => x.id === d.author.id);
      if (m) hit = { ns, doc: { guild: ws.guildId, userId: m.id, user: m.user, name: m.name, status: "needs", step: 0, answers: {}, tiktok: "", wa: "", startedAt: now(), msgs: [] } };
      if (hit) break;
    }
  }
  if (!hit) return;
  const { ns, doc: t } = hit;
  const g = guildOf(ns, t.guild);
  const cfg = cfgOf(ns, t.guild);
  const ob = obOf(ns, t.guild);
  const text = d.content || (d.attachments?.length ? "[attachment]" : "");
  t.channelId = d.channel_id;
  t.msgs = [...t.msgs, { from: "c", text, at: now() }].slice(-200);
  t.updatedAt = now();
  const phone = cfg.waDetect !== false && text.match(PHONE_RE);
  if (phone) t.wa = phone[1].trim();

  let reply = "";
  let finished = false;
  if (t.status === "progress" || t.status === "closed") {
    const q = ob.questions[t.step];
    const asksHandle = q && /tiktok|handle/i.test(q);
    const handle = asksHandle ? handleIn(text) : "";
    if (asksHandle && !handle && !t.handleAsked && !NO_HANDLE.test(text.trim())) {
      // Ask once more for just the handle; on a second miss we move on (it can be linked by hand later).
      t.handleAsked = true;
      t.status = "progress";
      reply = "Could you send just your TikTok handle? Like @yourname 🙂 If you don’t have one yet, reply “none”.";
    } else {
      if (q) {
        t.answers = { ...t.answers, [q]: text };
        if (asksHandle) t.tiktok = handle;
      }
      t.step++;
      if (t.step < ob.questions.length) {
        t.status = "progress";
        reply = ob.questions[t.step];
      } else {
        t.status = "done";
        t.doneAt = now();
        finished = true;
        reply = fill(ob.done || "Thanks, that’s everything. You’re all set! 🚀", { name: t.name }, g || { guildName: "the server" });
      }
    }
  } else {
    // Onboarding is over, so this is a question for the team.
    const firstAsk = t.status !== "needs";
    t.status = "needs";
    t.unread = true;
    if (firstAsk && cfg.notifyDm !== false && g) {
      await tellMods(ns, g.guildId, `💬 **${t.name}** sent the bot a DM that needs a reply:\n> ${text.slice(0, 300)}\nAnswer it in the dashboard under Onboarding & DMs.`);
    }
  }
  if (reply) {
    try {
      await discord.send(d.channel_id, reply);
      t.msgs.push({ from: "bot", text: reply, at: now() });
    } catch (e) {
      t.error = e.message;
    }
  }
  store.set(ns, "dms/" + t.userId, t);
  if (finished && g) await onboardingDone(ns, g, t, ob);
}

/** After the last answer: give the "onboarded" role and tell the mods. Never throws. */
async function onboardingDone(ns, g, t, ob) {
  if (ob.doneRole && g.roleNames?.[ob.doneRole]) {
    try {
      await discord.addRole(g.guildId, t.userId, ob.doneRole);
      audit.log(ns, audit.BOT, { category: "onboarding", action: "role.give", label: `${t.name} → ${g.roleNames[ob.doneRole]}`, summary: `${t.name} finished onboarding${t.tiktok ? ` (TikTok @${t.tiktok})` : ""}. Gave them the ${g.roleNames[ob.doneRole]} role` });
    } catch (e) {
      audit.log(ns, audit.BOT, { category: "onboarding", action: "role.give_failed", label: `${t.name} → ${g.roleNames[ob.doneRole]}`, summary: `Couldn’t give ${t.name} the ${g.roleNames[ob.doneRole]} role: ${e.message}` });
      console.error("[onboarding] role", e.message);
      store.set(ns, "dms/" + t.userId, { ...store.get(ns, "dms/" + t.userId), roleError: e.status === 403 ? `The bot couldn’t give the ${g.roleNames[ob.doneRole]} role. Give it Manage Roles and move it above that role.` : e.message });
    }
  }
  if (!(ob.doneRole && g.roleNames?.[ob.doneRole])) audit.log(ns, audit.BOT, { category: "onboarding", action: "onboarding.done", label: t.tiktok ? `${t.name} (@${t.tiktok})` : t.name, summary: `${t.name} finished onboarding${t.tiktok ? ` (TikTok @${t.tiktok})` : ""}` });
  if (ob.notifyDone !== false) {
    const answers = ob.questions.filter((q) => t.answers?.[q]).map((q) => `• ${q} ${String(t.answers[q]).slice(0, 120)}`).join("\n");
    await tellMods(ns, g.guildId, `🎉 **${t.name}** finished onboarding${t.tiktok ? ` · TikTok @${t.tiktok}` : " · no TikTok handle linked"}\n${answers}`);
  }
}

/** One friendly nudge to members who haven't answered the welcome DM. Called by the scheduler. */
export async function sendReminders() {
  for (const { ns, ws } of store.workspaces()) {
    if (!ws.guildId || !ws.done || cfgOf(ns, ws.guildId).reminders === false) continue;
    const hours = autosOf(ns, ws.guildId).onboarding?.reminderHours || 24;
    const cutoff = new Date(Date.now() - hours * 36e5).toISOString();
    const ob = obOf(ns, ws.guildId);
    for (const t of store.list(ns, "dms", (x) => x.guild === ws.guildId && x.status === "progress" && !x.reminded && x.updatedAt < cutoff)) {
      // Waiting on the creator: the bot spoke last (no reply at all, or they stopped halfway).
      if (!t.channelId || t.msgs[t.msgs.length - 1]?.from !== "bot") continue;
      const started = t.msgs.some((m) => m.from === "c");
      const q = ob.questions[t.step];
      const text = started && q
        ? `Just checking in, ${first(t.name)}. Only ${ob.questions.length - t.step} quick question${ob.questions.length - t.step === 1 ? "" : "s"} left: ${q}`
        : `Just checking in, ${first(t.name)}. Reply whenever you’re ready. 🙂`;
      const { id, ...doc } = t;
      try {
        await discord.send(t.channelId, text);
        doc.msgs = [...doc.msgs, { from: "bot", text, at: now() }];
      } catch { /* DMs closed since: stop trying */ }
      store.set(ns, "dms/" + id, { ...doc, reminded: true });
    }
  }
}

/* ---------- general chat manager ---------- */
const replies = new Map(); // guild|date → replies sent today

async function chatManager(ns, g, d) {
  const s = autosOf(ns, g.guildId).general_chat;
  if (!s?.enabled || s.channel !== d.channel_id || !ai.configured() || !d.content) return;
  if (!store.get(ns, "workspace/main")?.done) return;
  const me = (await discord.info()).bot?.id;
  const mentioned = (d.mentions || []).some((m) => m.id === me);
  const mode = s.replyTo || "questions";
  if (mode === "mentions" ? !mentioned : mode === "questions" ? !mentioned && !d.content.includes("?") : false) return;
  const key = g.guildId + "|" + ymd(new Date());
  if ((replies.get(key) || 0) >= (s.dailyCap || 300)) return;
  replies.set(key, (replies.get(key) || 0) + 1);

  const cfg = cfgOf(ns, g.guildId);
  const author = d.member?.nick || d.author.global_name || d.author.username;
  const owner = store.owner(ns);
  const out = await ai.chatReply({
    brand: owner?.brand || g.guildName, server: g.guildName, botName: cfg.botName || g.botName,
    voice: [cfg.tone, s.voice].filter(Boolean).join(" "), escalate: s.escalate,
    history: (recent.get(d.channel_id) || []).slice(0, -1), author, message: d.content,
  });
  if (out.action === "reply" && out.text) await discord.send(d.channel_id, out.text, { replyTo: d.id });
  else if (out.action === "escalate") {
    await tellMods(ns, g.guildId, `⚠️ **${author}** needs a person in <#${d.channel_id}>: ${out.text || d.content.slice(0, 300)}\nhttps://discord.com/channels/${g.guildId}/${d.channel_id}/${d.id}`);
    await discord.react(d.channel_id, d.id, ["👀"]);
  }
}

/** Entry point for gateway events. */
export function onEvent(type, d) {
  if (type === "MESSAGE_CREATE") return d.guild_id ? onGuildMessage(d) : onDm(d);
  if (type === "MESSAGE_REACTION_ADD") return onReaction(d);
  if (type === "GUILD_MEMBER_ADD") return onMemberAdd(d);
  if (type === "GUILD_MEMBER_REMOVE") return onMemberRemove(d);
  if (type === "VOICE_STATE_UPDATE") return onVoice(d);
}
