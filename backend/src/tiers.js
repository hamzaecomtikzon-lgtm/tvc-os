/*
 * Creator tiers: a Discord role per GMV level (🥉 Bronze, 🥈 Silver, 🥇 Gold, 💎 Diamond…).
 *
 * A creator is "linked" once onboarding saved their TikTok handle in their DM thread
 * (`dms/<userId>.tiktok`); their GMV over the chosen window comes from the CRM by that
 * handle. `plan` works out who should move (read-only: nothing changes in Discord);
 * `apply` creates the tier roles when needed and moves the members. Role ids are kept in
 * `tierroles/<guildId>` as `{ [tierId]: roleId }`, so renaming a tier renames its role.
 */
import { store } from "./store.js";
import { discord } from "./discord.js";
import { addDays, todayUTC, ymd } from "./dates.js";

export const DEFAULT_TIERS = [
  { id: "bronze", name: "Bronze", emoji: "🥉", color: "#cd7f32", min: 0 },
  { id: "silver", name: "Silver", emoji: "🥈", color: "#a8a9ad", min: 500 },
  { id: "gold", name: "Gold", emoji: "🥇", color: "#f1c40f", min: 2000 },
  { id: "diamond", name: "Diamond", emoji: "💎", color: "#5dade2", min: 10000 },
];
const WINDOWS = [30, 90, 365];
const MAX_CHANGES = 200;
const fail = (message, status = 400, code = "bad_request") => Object.assign(new Error(message), { status, code });

/** Clean tier settings: 1 to 8 tiers, sorted by threshold, with unique ids and thresholds. */
export function normalize(s = {}) {
  const raw = Array.isArray(s.tiers) && s.tiers.length ? s.tiers : DEFAULT_TIERS;
  const seen = new Set();
  const tiers = raw.slice(0, 8).map((t, i) => ({
    id: /^[a-z0-9]{1,24}$/i.test(t?.id || "") ? t.id : "t" + i,
    name: String(t?.name || "").trim().slice(0, 40) || `Tier ${i + 1}`,
    emoji: String(t?.emoji || "").trim().slice(0, 8),
    color: /^#[0-9a-f]{6}$/i.test(t?.color || "") ? t.color.toLowerCase() : "#99aab5",
    min: Math.max(0, Math.round(Number(t?.min) || 0)),
  })).filter((t) => !seen.has(t.id) && seen.add(t.id)).sort((a, b) => a.min - b.min);
  return {
    tiers,
    window: WINDOWS.includes(Number(s.window)) ? Number(s.window) : 30,
    demote: s.demote !== false,
    dm: s.dm !== false,
    channel: typeof s.channel === "string" ? s.channel : "",
  };
}

export const roleName = (t) => (t.emoji ? `${t.emoji} ${t.name}` : t.name);
const tierFor = (tiers, gmv) => [...tiers].reverse().find((t) => gmv >= t.min) || null;

/** Members linked to a TikTok handle, still in the server: `[{ userId, name, handle }]`. */
export function linkedMembers(ns, gid) {
  const members = new Map((store.get(ns, "members/" + gid)?.list || []).map((m) => [m.id, m]));
  return store.list(ns, "dms", (t) => t.guild === gid && t.tiktok)
    .filter((t) => !members.get(t.userId)?.left && !members.get(t.userId)?.bot)
    .map((t) => ({ userId: t.userId, name: members.get(t.userId)?.name || t.name, handle: String(t.tiktok).toLowerCase().replace(/^@/, "") }));
}

/** Run `fn` over `items`, `n` at a time. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  }));
  return out;
}

/**
 * Who belongs in which tier, and who has to move. Reads Discord to see each linked
 * member's current tier role; changes nothing.
 * → `{ settings, from, to, rows: [{ userId, name, handle, gmv, current, target }], changes, unlinked, near }`
 */
export async function plan(ns, g, rawSettings, { crm, shop }) {
  const s = normalize(rawSettings);
  const to = ymd(addDays(todayUTC(), -1));
  const from = ymd(addDays(todayUTC(), -s.window));
  const creators = await crm.listCreators({ shop_id: shop.id, date_from: from, date_to: to });
  const gmvOf = new Map(creators.map((c) => [String(c.handle).toLowerCase(), c.gmv || 0]));

  const roleIds = store.get(ns, "tierroles/" + g.guildId) || {};
  const tierOfRole = new Map(s.tiers.filter((t) => roleIds[t.id]).map((t) => [roleIds[t.id], t]));
  const linked = linkedMembers(ns, g.guildId);
  const current = tierOfRole.size
    ? await pool(linked, 5, async (m) => {
      const roles = await discord.memberRoles(g.guildId, m.userId).catch(() => []);
      if (roles === null) return undefined; // left the server
      return roles.map((r) => tierOfRole.get(r)).filter(Boolean).sort((a, b) => b.min - a.min)[0] || null;
    })
    : linked.map(() => null);

  const rank = (t) => (t ? s.tiers.indexOf(t) : -1);
  const rows = [];
  linked.forEach((m, i) => {
    if (current[i] === undefined) return;
    const gmv = gmvOf.get(m.handle) || 0;
    let target = tierFor(s.tiers, gmv);
    if (!s.demote && rank(current[i]) > rank(target)) target = current[i]; // never move anyone down
    rows.push({ ...m, gmv, current: current[i]?.id || null, target: target?.id || null });
  });
  const changes = rows.filter((r) => r.current !== r.target).sort((a, b) => b.gmv - a.gmv).slice(0, MAX_CHANGES);

  const linkedHandles = new Set(linked.map((m) => m.handle));
  const unlinked = creators.filter((c) => c.gmv > 0 && !linkedHandles.has(String(c.handle).toLowerCase())).length;
  // The linked creators closest (in dollars) to their next tier.
  const near = rows.map((r) => {
    const next = s.tiers.find((t) => t.min > r.gmv);
    return next ? { ...r, next: next.id, gap: next.min - r.gmv } : null;
  }).filter(Boolean).sort((a, b) => a.gap - b.gap).slice(0, 5);
  return { settings: s, from, to, rows, changes, unlinked, near };
}

/** The roles for each tier: reuses saved ones (renaming/recolouring them to match), creates the missing ones. */
async function ensureRoles(ns, g, tiers) {
  const existing = new Map((await discord.roles(g.guildId)).map((r) => [r.id, r]));
  const saved = store.get(ns, "tierroles/" + g.guildId) || {};
  const ids = { ...saved };
  for (const t of tiers) {
    const r = existing.get(saved[t.id]);
    const want = roleName(t);
    if (r) {
      if (r.name !== want || r.color !== parseInt(t.color.slice(1), 16)) await discord.editRole(g.guildId, r.id, { name: want, color: t.color });
    } else {
      ids[t.id] = (await discord.createRole(g.guildId, { name: want, color: t.color })).id;
    }
  }
  store.set(ns, "tierroles/" + g.guildId, ids);
  return ids;
}

/**
 * Move members to their new tier role. `action` is what plan() decided when the draft was
 * built: `{ tiers, changes, dm }`. Returns `{ moved, failed, errors }`.
 */
export async function apply(ns, g, action) {
  let ids;
  try {
    ids = await ensureRoles(ns, g, action.tiers);
  } catch (e) {
    if (e.status === 403) throw fail("The bot isn’t allowed to manage roles. In Server Settings → Roles, give the bot’s role Manage Roles and drag it above the tier roles, then try again.", 403, "missing_permission");
    throw e;
  }
  const tierIds = new Set(action.tiers.map((t) => ids[t.id]).filter(Boolean));
  const byId = new Map(action.tiers.map((t) => [t.id, t]));
  let moved = 0;
  const errors = [];
  for (const c of action.changes) {
    try {
      const roles = await discord.memberRoles(g.guildId, c.userId);
      if (roles === null) continue; // left since the draft was built
      const want = c.target ? ids[c.target] : null;
      for (const r of roles) if (tierIds.has(r) && r !== want) await discord.removeRole(g.guildId, c.userId, r);
      if (want && !roles.includes(want)) await discord.addRole(g.guildId, c.userId, want);
      moved++;
      const t = byId.get(c.target);
      const up = action.tiers.findIndex((x) => x.id === c.target) > action.tiers.findIndex((x) => x.id === c.current);
      if (action.dm && t && up) {
        const first = String(c.name || "").trim().split(/\s+/)[0] || "there";
        await discord.dm(c.userId, `Congrats ${first}! 🎉 You just reached **${roleName(t)}** in ${g.guildName}. Your new role is live in the server. Keep posting, the next tier is closer than you think 🚀`).catch(() => {});
      }
    } catch (e) {
      errors.push(`${c.name}: ${e.status === 403 ? "the bot’s role must be above the tier roles (Server Settings → Roles)" : e.message}`);
    }
  }
  store.set(ns, "tierstate/" + g.guildId, { lastApplied: new Date().toISOString(), moved, failed: errors.length, errors: errors.slice(0, 10) });
  return { moved, failed: errors.length, errors };
}

/** The draft for a plan: announcement messages for promotions, a summary of every change, and the action to apply. */
export function draftFor(p, g, shop) {
  const s = p.settings;
  const byId = new Map(s.tiers.map((t) => [t.id, t]));
  const rank = (id) => s.tiers.findIndex((t) => t.id === id);
  const $ = (v) => (shop.region === "uk" ? "£" : "$") + Math.round(v).toLocaleString("en-US");
  const label = (id) => (id ? roleName(byId.get(id)) : "no tier");
  const ups = p.changes.filter((c) => rank(c.target) > rank(c.current));
  const span = s.window === 365 ? "the last year" : `the last ${s.window} days`;

  const lines = ups.map((c) => `${byId.get(c.target).emoji || "⬆️"} <@${c.userId}> just reached **${byId.get(c.target).name}** · ${$(c.gmv)} in ${span}`);
  const messages = s.channel && ups.length
    ? [{ text: ["# 🎖️ Tier promotions", ...lines, "", "massive congrats, drop some love below 🎉"].join("\n") }]
    : [];
  const summary = p.changes.map((c) => `${rank(c.target) > rank(c.current) ? "⬆️" : "⬇️"} ${c.name} (@${c.handle}): ${label(c.current)} → ${label(c.target)} · ${$(c.gmv)}`);
  return {
    messages,
    channel: messages.length ? s.channel : "",
    summary: summary.join("\n"),
    action: { type: "tiers", tiers: s.tiers, dm: s.dm, changes: p.changes.map(({ userId, name, handle, gmv, current, target }) => ({ userId, name, handle, gmv, current, target })) },
  };
}
