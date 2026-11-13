/*
 * What the bot does with live Discord events: counts community activity,
 * welcomes new members by DM and records their answers, keeps the DM inbox,
 * lets moderators approve drafts with a reaction, and answers the general chat.
 */
import { store } from "./store.js";
import { discord, memberRow } from "./discord.js";
import { ai } from "./ai.js";
import { ymd } from "./dates.js";
import { autosOf, cfgOf, obOf, startJob, tellMods } from "./jobs.js";

const now = () => new Date().toISOString();
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;
const first = (name) => String(name || "there").trim().split(/\s+/)[0];

/** The TikTok handle in a reply: the @name if there is one, otherwise the last word ("it's mia.beauty"). */
function handleIn(text) {
  const raw = text.match(/@([a-z0-9._]{2,24})/i)?.[1] || text.match(/tiktok\.com\/@?([a-z0-9._]{2,24})/i)?.[1] || text.trim().split(/\s+/).pop() || "";
  const h = raw.replace(/^@/, "").replace(/[^a-z0-9._]/gi, "").replace(/\.+$/, "").toLowerCase();
  return h.length >= 2 ? h : "";
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

/* ---------- approvals from the moderator channel ---------- */
async function approveByReaction(ns, d) {
  const emoji = d.emoji?.name;
  if (emoji !== "✅" && emoji !== "❌") return;
  if (cfgOf(ns, d.guild_id).modChannel !== d.channel_id) return;
  const draft = store.list(ns, "drafts", (x) => x.modMessageId === d.message_id && x.status === "pending")[0];
  if (!draft) return;
  const by = d.member?.nick || d.member?.user?.global_name || d.member?.user?.username || "a moderator";
  await startJob(ns, emoji === "✅" ? "post" : "reject", { draftId: draft.id, by: by + " (in Discord)" }).done;
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
  if (on && store.get(ns, "workspace/main")?.done) return startOnboarding(ns, g, row);
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
  if (t.status === "progress" || t.status === "closed") {
    const q = ob.questions[t.step];
    if (q) {
      t.answers = { ...t.answers, [q]: text };
      if (/tiktok|handle/i.test(q)) t.tiktok = handleIn(text);
    }
    t.step++;
    if (t.step < ob.questions.length) {
      t.status = "progress";
      reply = ob.questions[t.step];
    } else {
      t.status = "done";
      reply = phone ? "Got it, saved. You’re all set! 🚀" : "Thanks, that’s everything. You’re all set! 🚀";
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
}

/** One friendly nudge to members who haven't answered the welcome DM. Called by the scheduler. */
export async function sendReminders() {
  for (const { ns, ws } of store.workspaces()) {
    if (!ws.guildId || !ws.done || cfgOf(ns, ws.guildId).reminders === false) continue;
    const hours = autosOf(ns, ws.guildId).onboarding?.reminderHours || 24;
    const cutoff = new Date(Date.now() - hours * 36e5).toISOString();
    for (const t of store.list(ns, "dms", (x) => x.guild === ws.guildId && x.status === "progress" && !x.reminded && x.updatedAt < cutoff)) {
      if (t.msgs.some((m) => m.from === "c") || !t.channelId) continue;
      const text = `Just checking in, ${first(t.name)}. Reply whenever you’re ready. 🙂`;
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
