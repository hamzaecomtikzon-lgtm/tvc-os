/*
 * Audit log: who did what, and when, in each workspace. Team members (in the app
 * or approving in Discord), the schedule and the bot itself all write here.
 *
 * Each entry has table columns (who, account type, shop, platform, action, target)
 * plus a full sentence (`summary`) and optional details for the expanded row.
 *
 * Kept in its own table, not the document store: it's never sent to the browser
 * with the workspace, survives a workspace reset, and is read page by page.
 */
import { sql, store } from "./store.js";

sql.exec(`
  CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ns TEXT NOT NULL, at TEXT NOT NULL,
    actor_type TEXT NOT NULL, actor_name TEXT NOT NULL, actor_email TEXT, actor_role TEXT,
    category TEXT NOT NULL, action TEXT NOT NULL, target TEXT, summary TEXT NOT NULL, details TEXT
  );
  CREATE INDEX IF NOT EXISTS audit_ns_id ON audit (ns, id);
`);
const cols = sql.prepare("PRAGMA table_info(audit)").all().map((c) => c.name);
for (const c of ["target_label", "shop_id", "platform"]) if (!cols.includes(c)) sql.exec(`ALTER TABLE audit ADD COLUMN ${c} TEXT`);

const KEEP_DAYS = 365;
const COALESCE_MS = 2 * 60_000; // the same person changing the same thing again within 2 minutes updates one entry

const q = {
  add: sql.prepare("INSERT INTO audit (ns, at, actor_type, actor_name, actor_email, actor_role, category, action, target, target_label, shop_id, platform, summary, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
  last: sql.prepare("SELECT * FROM audit WHERE ns = ? ORDER BY id DESC LIMIT 1"),
  bump: sql.prepare("UPDATE audit SET at = ?, summary = ?, target_label = ?, details = ? WHERE id = ?"),
  prune: sql.prepare("DELETE FROM audit WHERE at < ?"),
  actors: sql.prepare("SELECT actor_type AS type, actor_name AS name, MAX(actor_email) AS email, MAX(id) AS last FROM audit WHERE ns = ? GROUP BY actor_type, actor_name ORDER BY last DESC LIMIT 200"),
  actions: sql.prepare("SELECT DISTINCT action FROM audit WHERE ns = ?"),
  shops: sql.prepare("SELECT DISTINCT shop_id FROM audit WHERE ns = ? AND shop_id IS NOT NULL"),
  platforms: sql.prepare("SELECT DISTINCT platform FROM audit WHERE ns = ? AND platform IS NOT NULL"),
};

export const CATEGORIES = {
  posts: "Drafts & posts", automations: "Automations", creators: "Creators & DMs", onboarding: "Onboarding",
  bot: "Bot & server", team: "Team", security: "Security", settings: "Settings",
};

/** The short name shown in the Action column, by action code. */
export const ACTIONS = {
  "auth.signup": "Signed up", "auth.join": "Joined team", "auth.signin": "Signed in", "auth.signout": "Signed out",
  "crm.connect": "Connected CRM", "crm.key_change": "Replaced CRM key", "crm.disconnect": "Disconnected CRM", "crm.pick": "Picked CRM",
  "brand.rename": "Renamed brand", "profile.rename": "Changed name",
  "team.invite": "Invited member", "team.role": "Changed role", "team.remove": "Removed member", "team.uninvite": "Cancelled invite",
  "workspace.reset": "Reset workspace", "setup.done": "Finished setup",
  "automations.setup": "Set up automations", "automation.on": "Turned on automation", "automation.off": "Paused automation", "automation.edit": "Edited automation",
  "custom.create": "Created custom automation", "custom.edit": "Edited custom automation", "custom.delete": "Deleted custom automation",
  "settings.edit": "Changed settings", "scoring.edit": "Changed scoring", "channels.map": "Changed channel mapping", "shop.switch": "Switched shop",
  "onboarding.edit": "Edited onboarding",
  "bot.picture": "Changed bot picture", "bot.rename": "Renamed bot", "bot.profile_warning": "Bot profile warning",
  "discord.connect": "Connected Discord server", "server.sync": "Refreshed server", "channels.create": "Created channels", "channels.create_failed": "Channel creation failed",
  "draft.build": "Built draft", "draft.build_failed": "Draft build failed", "draft.nothing": "Ran automation", "draft.edit": "Edited draft", "draft.delete": "Deleted draft",
  "draft.post": "Posted draft", "draft.post_failed": "Post failed", "draft.reject": "Rejected draft", "draft.test": "Sent test post",
  "dm.reply": "Replied to DM", "dm.resolve": "Resolved DM", "dm.reopen": "Reopened DM", "creator.link": "Linked TikTok", "creator.unlink": "Unlinked TikTok",
  "onboarding.welcome": "Sent welcome DM", "onboarding.welcome_failed": "Welcome DM failed", "onboarding.welcome_all": "Sent welcome DMs", "onboarding.done": "Finished onboarding",
  "role.give": "Gave role", "role.give_failed": "Role failed",
};
export const actionLabel = (code) => ACTIONS[code] || String(code).split(".").pop().replace(/_/g, " ");

/* ---------- actors ---------- */

/** A signed-in team member. */
export const actorOf = (user) => ({ type: "user", name: user.name, email: user.email, role: user.role });
export const BOT = { type: "bot", name: "Bot" };
export const SCHEDULE = { type: "schedule", name: "Schedule" };
export const SYSTEM = { type: "system", name: "System" };
/** A moderator acting in Discord (reacting ✅/❌ in the approvals channel). */
export const discordActor = (name) => ({ type: "discord", name: String(name || "A moderator").slice(0, 80), role: "Discord moderator" });
/** Where an action came from, for the Platform column. */
const PLATFORM = { user: "Web app", discord: "Discord", schedule: "Schedule", bot: "Bot", system: "System" };

/* ---------- writing ---------- */

/**
 * Record one action. `e`: { category, action, summary, label?, target?, details?, fields?, prefix? }.
 * `label` is the Target column ("Winning angle of the week", "mia@acme.co"). With `fields` (what changed)
 * and `prefix`, the summary is `prefix + fields`, and a repeat within two minutes by the same person on the
 * same target merges into the earlier entry. Never throws: a logging problem must never break the action.
 */
export function log(ns, actor, e) {
  if (!ns || !e) return;
  try {
    const a = actor || SYSTEM;
    const now = new Date();
    const details = { ...(e.details || {}), ...(e.fields ? { fields: e.fields } : {}) };
    // With no label of its own, a settings-style change is labelled by the names of what changed (without the new values).
    const labelOf = (fields) => e.label ?? (fields?.length ? fields.map((f) => f.split(" → ")[0]).join(", ") : null);
    if (e.fields && e.target) {
      const prev = q.last.get(ns);
      if (prev && prev.actor_type === a.type && prev.actor_name === a.name && prev.action === e.action && prev.target === e.target && now - Date.parse(prev.at) < COALESCE_MS) {
        const old = JSON.parse(prev.details || "{}");
        const fields = [...new Set([...(old.fields || []).filter((f) => !e.fields.some((n) => n.split(" → ")[0] === f.split(" → ")[0])), ...e.fields])];
        q.bump.run(now.toISOString(), e.prefix + fields.join(", "), labelOf(fields), JSON.stringify({ ...old, ...details, fields }), prev.id);
        return;
      }
    }
    const summary = e.fields && e.prefix != null ? e.prefix + e.fields.join(", ") : e.summary;
    const shop = store.get(ns, "workspace/main")?.shopId || null;
    q.add.run(ns, now.toISOString(), a.type, String(a.name).slice(0, 120), a.email || null, a.role || null,
      e.category, e.action, e.target || null, labelOf(e.fields) ? String(labelOf(e.fields)).slice(0, 200) : null, shop, e.platform || PLATFORM[a.type] || "System",
      String(summary).slice(0, 500), Object.keys(details).length ? JSON.stringify(details).slice(0, 8000) : null);
    if (Math.random() < 0.01) q.prune.run(new Date(Date.now() - KEEP_DAYS * 864e5).toISOString());
  } catch (err) {
    console.error("[audit]", err.message);
  }
}

/* ---------- reading ---------- */

/** A page of entries, newest first. `before` is the `next` cursor from the previous page. */
export function list(ns, { category, actor, action, shop, platform, q: text, before, from, to, limit = 50 } = {}) {
  const where = ["ns = ?"], args = [ns];
  if (category && CATEGORIES[category]) { where.push("category = ?"); args.push(category); }
  if (actor) {
    const [type, ...name] = String(actor).split(":");
    where.push("actor_type = ? AND actor_name = ?"); args.push(type, name.join(":"));
  }
  if (action) { where.push("action = ?"); args.push(String(action)); }
  if (shop) { where.push("shop_id = ?"); args.push(String(shop)); }
  if (platform) { where.push("platform = ?"); args.push(String(platform)); }
  if (text) {
    where.push("(summary LIKE ? OR actor_name LIKE ? OR actor_email LIKE ? OR target_label LIKE ?)");
    args.push(...Array(4).fill(`%${text}%`));
  }
  if (before) { where.push("id < ?"); args.push(Number(before) || 0); }
  if (from) { where.push("at >= ?"); args.push(String(from)); }
  if (to) { where.push("at < ?"); args.push(String(to)); }
  const n = Math.max(1, Math.min(500, Number(limit) || 50));
  const rows = sql.prepare(`SELECT * FROM audit WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`).all(...args, n + 1);
  const entries = rows.slice(0, n).map((r) => ({
    id: r.id, at: r.at, category: r.category, action: r.action, actionLabel: actionLabel(r.action),
    target: r.target_label, shopId: r.shop_id, platform: r.platform || PLATFORM[r.actor_type], summary: r.summary,
    actor: { type: r.actor_type, name: r.actor_name, email: r.actor_email, role: r.actor_role },
    details: r.details ? JSON.parse(r.details) : null,
  }));
  return { entries, next: rows.length > n ? entries[entries.length - 1].id : null };
}

/** The choices for each filter, from what's actually in this workspace's log. */
export function facets(ns) {
  return {
    actors: q.actors.all(ns).map((r) => ({ type: r.type, name: r.name, email: r.email })),
    actions: q.actions.all(ns).map((r) => ({ code: r.action, label: actionLabel(r.action) })).sort((a, b) => a.label.localeCompare(b.label)),
    shops: q.shops.all(ns).map((r) => r.shop_id),
    platforms: q.platforms.all(ns).map((r) => r.platform).sort(),
  };
}

/* ---------- describing document saves ---------- */

const AUTO = {
  general_chat: "General chat manager", viral_hooks: "Viral hooks", winning_content: "Winning angle of the week", wins: "Creator wins",
  leaderboard: "Weekly leaderboard", onboarding: "Creator onboarding", tiers: "Creator tiers", samples: "Sample follow-ups",
};
export const autoName = (key) => AUTO[key] || String(key).replace(/_/g, " ");

const LABELS = {
  // config
  timezone: "time zone", weekStart: "week start", modChannel: "approvals channel", notifyDraft: "new-draft notifications",
  notifyDm: "DM notifications", digest: "weekly summary", dmNew: "welcome DMs for new members", waDetect: "WhatsApp detection",
  reminders: "onboarding reminders", tone: "brand voice",
  // automation settings
  channel: "channel", time: "time", days: "days", mode: "approval mode", mention: "mention", niche: "niche", lookback: "lookback",
  thresholds: "milestones", max: "max posts", topN: "number of creators", graphic: "graphic", parts: "parts included", voice: "voice",
  rules: "rules", language: "language", product: "product", replyTo: "replies to", dailyCap: "daily reply cap", escalate: "escalation topics",
  tiers: "tiers", text: "message", text2: "second message",
  // onboarding
  welcome: "welcome message", questions: "questions", done: "closing message", doneRole: "role when finished", notifyDone: "notify mods when finished",
  // custom
  name: "name", on: "on/off", approval: "needs approval",
};
const IGNORE = new Set(["guild", "updatedAt", "createdAt", "chat", "enabled"]);
const label = (k) => LABELS[k] || k.replace(/([A-Z])/g, " $1").toLowerCase();
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const changed = (a = {}, b = {}) => [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].filter((k) => !IGNORE.has(k) && !same(a?.[k], b?.[k]));

/** A short, readable value for a setting ("#wins", "on", "Mon, Wed"), or null when it would be noise. */
function show(k, v, chan) {
  if (typeof v === "boolean") return v ? "on" : "off";
  if (v == null || v === "") return k === "channel" || k === "modChannel" ? "none" : null;
  if ((k === "channel" || k === "modChannel") && typeof v === "string") return v === "dm" ? "DMs" : "#" + chan(v);
  if (Array.isArray(v) && v.every((x) => typeof x === "string") && v.join(", ").length <= 60) return v.join(", ");
  if (typeof v === "string" && v.length <= 40) return v;
  if (typeof v === "number") return String(v);
  return null;
}
const fieldList = (keys, after, chan) => keys.map((k) => { const v = show(k, after?.[k], chan); return v ? `${label(k)} → ${v}` : label(k); });

/**
 * What a document save means, as audit entries. `before`/`after` are the stored documents
 * (after = null for a delete). Returns [] for saves that aren't worth recording.
 */
export function describeDoc(ns, path, before, after) {
  const [col, id = ""] = path.split("/");
  const gid = store.get(ns, "workspace/main")?.guildId;
  const g = gid && store.get(ns, "discord/" + gid);
  const chan = (cid) => g?.channels?.find((c) => c.id === cid)?.name || "unknown-channel";
  const out = [];

  if (col === "automations") {
    const a = before?.items || {}, b = after?.items || {};
    if (!before) return [{ category: "automations", action: "automations.setup", label: "All automations", summary: "Set up the automations" }];
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const was = a[key] || {}, now = b[key] || {};
      const name = autoName(key);
      if (!!was.enabled !== !!now.enabled) out.push({ category: "automations", action: now.enabled ? "automation.on" : "automation.off", target: key, label: name, summary: `${now.enabled ? "Turned on" : "Paused"} “${name}”` });
      const keys = changed(was, now);
      if (keys.length) out.push({ category: "automations", action: "automation.edit", target: key, label: name, prefix: `Edited “${name}”: `, fields: fieldList(keys, now, chan) });
    }
    return out;
  }

  if (col === "config") {
    const keys = changed(before, after).filter((k) => k !== "botName"); // the bot's name is logged with its picture
    if (keys.length) out.push({ category: "settings", action: "settings.edit", target: path, prefix: "Changed settings: ", fields: fieldList(keys, after, chan) });
    return out;
  }

  if (col === "workspace") {
    if (!before) return out;
    const b0 = before.bot || {}, b1 = after?.bot || {};
    const botName = b1.name || b0.name || "Bot";
    if ((b0.avatar || "") !== (b1.avatar || "")) out.push({ category: "bot", action: "bot.picture", label: botName, summary: b1.avatar ? (b0.avatar ? "Changed the bot picture (the logo on cards changes too)" : "Added a bot picture (used as the logo on cards)") : "Removed the bot picture" });
    if ((b0.name || "") !== (b1.name || "") && b1.name) out.push({ category: "bot", action: "bot.rename", label: b1.name, summary: `Renamed the bot from “${b0.name || "Bot"}” to “${b1.name}”` });
    if (before.guildId !== after?.guildId && after?.guildId) {
      const server = store.get(ns, "discord/" + after.guildId)?.guildName || after.guildId;
      out.push({ category: "security", action: "discord.connect", label: server, summary: `Connected the Discord server ${server}` });
    }
    if (before.shopId !== after?.shopId && after?.shopId) out.push({ category: "settings", action: "shop.switch", label: after.shopId, summary: "Switched the TikTok Shop the automations use", details: { shopId: after.shopId } });
    if (!same(before.crm, after?.crm) && after?.crm) {
      const crm = typeof after.crm === "string" ? after.crm : after.crm.name || "a CRM";
      out.push({ category: "settings", action: "crm.pick", label: crm, summary: `Picked ${crm} as the CRM` });
    }
    if (!same(before.map, after?.map) && before.map) out.push({ category: "settings", action: "channels.map", target: path, label: "Automation channels", prefix: "Changed which channels automations use", fields: [] });
    if (!before.done && after?.done) out.push({ category: "settings", action: "setup.done", label: "Setup guide", summary: "Finished the setup guide" });
    return out;
  }

  if (col === "onboarding") {
    const keys = changed(before, after);
    if (keys.length) out.push({ category: "onboarding", action: "onboarding.edit", target: path, prefix: "Edited onboarding: ", fields: keys.map(label) });
    return out;
  }

  if (col === "scoring") {
    if (changed(before, after).length) out.push({ category: "settings", action: "scoring.edit", target: path, label: "Creator scoring", prefix: "Changed creator scoring", fields: [] });
    return out;
  }

  if (col === "custom") {
    const name = (after || before)?.name || "Custom automation";
    if (!after) return [{ category: "automations", action: "custom.delete", label: name, summary: `Deleted the custom automation “${name}”` }];
    if (!before) return [{ category: "automations", action: "custom.create", label: name, summary: `Created the custom automation “${name}”${after.on ? " (on)" : ""}` }];
    if (!!before.on !== !!after.on) out.push({ category: "automations", action: after.on ? "automation.on" : "automation.off", target: "custom:" + id, label: name, summary: `${after.on ? "Turned on" : "Paused"} “${name}”` });
    const keys = changed(before, after).filter((k) => k !== "on");
    if (keys.length) out.push({ category: "automations", action: "custom.edit", target: "custom:" + id, label: name, prefix: `Edited “${name}”: `, fields: fieldList(keys, after, chan) });
    return out;
  }

  if (col === "drafts") {
    const name = (after || before)?.name || "Draft";
    if (!after) return [{ category: "posts", action: "draft.delete", label: name, summary: `Deleted the draft “${name}”` }];
    if (before && !same(before.messages, after.messages)) out.push({ category: "posts", action: "draft.edit", target: path, label: name, prefix: `Edited the draft “${name}” before approval`, fields: [] });
    return out;
  }

  return out; // allowlists are derived from the channel settings and aren't worth a line of their own
}
