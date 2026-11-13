/*
 * Discord REST client for the bot (https://discord.com/developers/docs).
 * Needs DISCORD_BOT_TOKEN in backend/.env. Live events (joins, DMs, messages,
 * reactions) arrive over the gateway connection in gateway.js.
 */
const API = process.env.DISCORD_API_BASE || "https://discord.com/api/v10"; // overridable for tests
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PERM = { ADMIN: 1n << 3n, MANAGE_CHANNELS: 1n << 4n, VIEW: 1n << 10n, SEND: 1n << 11n };
// view, send, embed, attach, react, mention everyone, manage channels, manage roles, history, change nickname
const INVITE_PERMISSIONS = "335793232";
const TEXT_TYPES = [0, 5]; // text, announcement
const CATEGORY = 4;

const token = () => (process.env.DISCORD_BOT_TOKEN || "").trim();

export class DiscordError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call(method, path, body) {
  if (!token()) throw new DiscordError("The Discord bot token isn’t set. Add DISCORD_BOT_TOKEN to backend/.env and restart the server.", 503, "not_configured");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API + path, {
      method,
      headers: { Authorization: "Bot " + token(), "Content-Type": "application/json", "User-Agent": "DiscordBot (https://localhost, 1.0)" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 4) {
      const wait = (await res.json().catch(() => ({}))).retry_after || 1;
      await sleep(wait * 1000 + 100);
      continue;
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (res.ok) return data;
    if (res.status === 401) throw new DiscordError("Discord rejected the bot token. Check DISCORD_BOT_TOKEN in backend/.env.", 401, "bad_token");
    throw new DiscordError(data?.message || "Discord error " + res.status, res.status, data?.code);
  }
}

let me = null; // the bot's own user, cached after the first call
async function self() {
  return (me ||= await call("GET", "/users/@me"));
}

/** Effective permissions of the bot in one channel. */
function permsIn(guild, member, channel) {
  const roles = new Map(guild.roles.map((r) => [r.id, BigInt(r.permissions)]));
  let p = roles.get(guild.id) || 0n;
  for (const id of member.roles) p |= roles.get(id) || 0n;
  if (guild.owner_id === member.user.id || p & PERM.ADMIN) return ~0n;
  const ow = channel.permission_overwrites || [];
  const apply = (o) => { p = (p & ~BigInt(o.deny || 0)) | BigInt(o.allow || 0); };
  const everyone = ow.find((o) => o.id === guild.id);
  if (everyone) apply(everyone);
  let allow = 0n, deny = 0n;
  for (const o of ow) {
    if (o.type === 0 && o.id !== guild.id && member.roles.includes(o.id)) {
      allow |= BigInt(o.allow || 0);
      deny |= BigInt(o.deny || 0);
    }
  }
  p = (p & ~deny) | allow;
  const mine = ow.find((o) => o.type === 1 && o.id === member.user.id);
  if (mine) apply(mine);
  return p;
}

/** Channel name without its emoji prefix: "🏆・share-wins" → "share-wins". */
const baseName = (n) => String(n).replace(/^.*・/, "").replace(/^[^a-z0-9]+/i, "").toLowerCase();

export const discord = {
  configured: () => !!token(),

  /** Who the bot is, and the link that adds it to a server. */
  async info() {
    if (!token()) return { configured: false };
    try {
      const u = await self();
      return {
        configured: true,
        bot: { id: u.id, name: u.global_name || u.username },
        inviteUrl: `https://discord.com/oauth2/authorize?client_id=${u.id}&permissions=${INVITE_PERMISSIONS}&scope=bot%20applications.commands`,
      };
    } catch (e) {
      return { configured: false, error: e.message };
    }
  },

  /** Servers the bot has joined: `[{ id, name }]`. */
  async guilds() {
    return (await call("GET", "/users/@me/guilds")).map((g) => ({ id: g.id, name: g.name }));
  },

  /** One server as the app stores it: text channels in sidebar order, with what the bot can do in each. */
  async guild(id) {
    const bot = await self();
    const [g, channels, member] = await Promise.all([
      call("GET", "/guilds/" + id),
      call("GET", `/guilds/${id}/channels`),
      call("GET", `/guilds/${id}/members/${bot.id}`),
    ]);
    const cats = new Map(channels.filter((c) => c.type === CATEGORY).map((c) => [c.id, c]));
    const order = (c) => (c.parent_id ? (cats.get(c.parent_id)?.position ?? 0) + 1 : 0) * 1000 + c.position;
    const base = permsIn(g, member, {});
    return {
      guildId: g.id,
      guildName: g.name,
      botName: member.nick || bot.global_name || bot.username,
      channels: channels
        .filter((c) => TEXT_TYPES.includes(c.type))
        .sort((a, b) => order(a) - order(b))
        .map((c) => {
          const p = permsIn(g, member, c);
          return { id: c.id, name: c.name, category: cats.get(c.parent_id)?.name || "", canPost: Boolean(p & PERM.VIEW && p & PERM.SEND) };
        }),
      roleNames: Object.fromEntries(g.roles.filter((r) => r.id !== g.id).map((r) => [r.id, r.name])),
      roles: g.roles.filter((r) => r.id !== g.id && !r.managed).sort((a, b) => b.position - a.position).map((r) => r.name),
      canManageChannels: Boolean(base & PERM.MANAGE_CHANNELS),
      syncedAt: new Date().toISOString(),
    };
  },

  /** Set the bot's nickname (and picture, when Discord allows it) in one server. */
  async setProfile(guildId, { name, avatar }) {
    const nick = String(name || "").trim().slice(0, 32);
    if (avatar?.startsWith("data:image/")) {
      try {
        return await call("PATCH", `/guilds/${guildId}/members/@me`, { nick, avatar });
      } catch {
        /* per-server pictures aren't available to every bot: fall back to the name only */
      }
    }
    return call("PATCH", `/guilds/${guildId}/members/@me`, { nick });
  },

  /**
   * Create channels (and their categories) that don't exist yet.
   * `todo` is `[{ name, category, perm }]` with perm "everyone" | "read" | "mods".
   * Returns the names that were created.
   */
  async createChannels(guildId, todo) {
    const bot = await self();
    const existing = await call("GET", `/guilds/${guildId}/channels`);
    const cats = new Map(existing.filter((c) => c.type === CATEGORY).map((c) => [c.name.toLowerCase(), c.id]));
    const taken = new Set(existing.filter((c) => TEXT_TYPES.includes(c.type)).map((c) => baseName(c.name)));
    const botRow = { id: bot.id, type: 1, allow: String(PERM.VIEW | PERM.SEND) };
    const overwrites = {
      everyone: [],
      read: [{ id: guildId, type: 0, deny: String(PERM.SEND) }, botRow],
      mods: [{ id: guildId, type: 0, deny: String(PERM.VIEW) }, botRow],
    };
    const created = [];
    for (const x of todo) {
      if (taken.has(baseName(x.name))) continue;
      let parent = null;
      if (x.category && x.category !== "No category") {
        const key = x.category.toLowerCase();
        if (!cats.has(key)) cats.set(key, (await call("POST", `/guilds/${guildId}/channels`, { name: x.category, type: CATEGORY })).id);
        parent = cats.get(key);
      }
      const ch = await call("POST", `/guilds/${guildId}/channels`, {
        name: x.name, type: 0, parent_id: parent, permission_overwrites: overwrites[x.perm] || [],
      });
      taken.add(baseName(ch.name));
      created.push(ch.name);
    }
    return created;
  },

  /**
   * Post text to a channel (split at Discord's 2,000-character limit). Returns the last message.
   * `replyTo` is a message id in the same channel to answer.
   */
  async send(channelId, text, { replyTo } = {}) {
    let last = null;
    for (const content of chunks(String(text), 2000)) {
      last = await call("POST", `/channels/${channelId}/messages`, {
        content,
        allowed_mentions: { parse: ["users", "everyone"], replied_user: false },
        ...(replyTo && !last ? { message_reference: { message_id: replyTo, fail_if_not_exists: false } } : {}),
      });
    }
    return last;
  },

  /** Send a direct message to a member. Returns `{ channelId, message }`. */
  async dm(userId, text) {
    const ch = await call("POST", "/users/@me/channels", { recipient_id: userId });
    return { channelId: ch.id, message: await discord.send(ch.id, text) };
  },

  /** Add the bot's reaction to a message. Failures are ignored: a missing reaction never blocks a post. */
  async react(channelId, messageId, emojis) {
    for (const e of emojis) {
      await call("PUT", `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(e)}/@me`).catch(() => {});
    }
  },

  /**
   * Everyone in a server: `[{ id, user, name, joined, roles, bot }]`, or null when the bot
   * may not list members (the Server Members intent is off in the Developer Portal).
   */
  async members(guildId, roleNames = {}) {
    const me = await self();
    const out = [];
    try {
      for (let after = "0"; ;) {
        const page = await call("GET", `/guilds/${guildId}/members?limit=1000&after=${after}`);
        for (const m of page) out.push({ ...memberRow(m, roleNames), ...(m.user.id === me.id ? { bot: true } : {}) });
        if (page.length < 1000) break;
        after = page[page.length - 1].user.id;
      }
    } catch (e) {
      if (e.status === 403) return null;
      throw e;
    }
    return out;
  },

  /** Which privileged gateway intents the application has switched on. */
  async intents() {
    const flags = (await call("GET", "/applications/@me")).flags || 0;
    return { members: Boolean(flags & ((1 << 14) | (1 << 15))), content: Boolean(flags & ((1 << 18) | (1 << 19))) };
  },

  token,
};

/** A guild member as the app stores it. */
export function memberRow(m, roleNames = {}) {
  return {
    id: m.user.id,
    user: m.user.username,
    name: m.nick || m.user.global_name || m.user.username,
    joined: (m.joined_at || "").slice(0, 10),
    roles: (m.roles || []).map((r) => roleNames[r]).filter(Boolean),
    bot: !!m.user.bot,
  };
}

function chunks(text, max) {
  const out = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest.trim()) out.push(rest);
  return out;
}
