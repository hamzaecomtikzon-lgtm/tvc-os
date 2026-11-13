/*
 * Discord gateway: one WebSocket that delivers live events (members joining,
 * DMs, messages, reactions, voice) to `onEvent(type, data)`. Reconnects and
 * resumes on its own. https://discord.com/developers/docs/events/gateway
 */
import { discord } from "./discord.js";

const URL0 = process.env.DISCORD_GATEWAY_URL || "wss://gateway.discord.gg";
const QUERY = "/?v=10&encoding=json";
const INTENT = {
  GUILDS: 1 << 0, MEMBERS: 1 << 1, VOICE: 1 << 7, MESSAGES: 1 << 9, REACTIONS: 1 << 10, DMS: 1 << 12, CONTENT: 1 << 15,
};
const BASE = INTENT.GUILDS | INTENT.VOICE | INTENT.MESSAGES | INTENT.REACTIONS | INTENT.DMS;

/** What the UI shows: is the bot listening, and with which optional powers. */
export const status = { connected: false, members: false, content: false, error: null };

let ws = null, seq = null, sessionId = null, resumeUrl = null, beat = null, acked = true, retry = 0, onEvent = () => {}, stopped = false;

const send = (op, d) => ws?.readyState === 1 && ws.send(JSON.stringify({ op, d }));

function intents() {
  return BASE | (status.members ? INTENT.MEMBERS : 0) | (status.content ? INTENT.CONTENT : 0);
}

function connect() {
  if (stopped) return;
  const resuming = Boolean(sessionId && resumeUrl);
  ws = new WebSocket((resuming ? resumeUrl : URL0) + QUERY);

  ws.onmessage = (e) => {
    const p = JSON.parse(e.data);
    if (p.s != null) seq = p.s;
    if (p.op === 10) {
      clearInterval(beat);
      acked = true;
      const pulse = () => {
        if (!acked) return ws.close(4000); // the connection went quiet: start over
        acked = false;
        send(1, seq);
      };
      setTimeout(pulse, p.d.heartbeat_interval * Math.random());
      beat = setInterval(pulse, p.d.heartbeat_interval);
      if (resuming) send(6, { token: discord.token(), session_id: sessionId, seq });
      else send(2, { token: discord.token(), intents: intents(), properties: { os: process.platform, browser: "kreo", device: "kreo" } });
    } else if (p.op === 11) acked = true;
    else if (p.op === 1) send(1, seq);
    else if (p.op === 7) ws.close(4000);
    else if (p.op === 9) {
      if (!p.d) sessionId = null;
      ws.close(4000);
    } else if (p.op === 0) {
      if (p.t === "READY") {
        sessionId = p.d.session_id;
        resumeUrl = p.d.resume_gateway_url;
      }
      if (p.t === "READY" || p.t === "RESUMED") {
        retry = 0;
        status.connected = true;
        status.error = null;
      }
      Promise.resolve().then(() => onEvent(p.t, p.d)).catch((err) => console.error(`[gateway ${p.t}]`, err));
    }
  };

  ws.onclose = (e) => {
    clearInterval(beat);
    status.connected = false;
    if (stopped) return;
    if (e.code === 4004) return void (status.error = "Discord rejected the bot token.");
    if (e.code === 4014) {
      // An intent we asked for isn't switched on for this bot: carry on without the optional ones.
      if (!status.members && !status.content) return void (status.error = "Discord refused the bot’s connection settings.");
      status.members = status.content = false;
      sessionId = null;
    }
    if ([4007, 4009].includes(e.code)) sessionId = null;
    setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry++));
  };
  ws.onerror = () => {};
}

export const gateway = {
  status,
  /** Start listening. Does nothing without a bot token, or when DISCORD_GATEWAY=off. */
  async start(handler) {
    if (!discord.configured() || process.env.DISCORD_GATEWAY === "off") return false;
    // A test API without a test gateway would connect a second listener to the real bot.
    if (process.env.DISCORD_API_BASE && !process.env.DISCORD_GATEWAY_URL) return false;
    onEvent = handler;
    try {
      Object.assign(status, await discord.intents());
    } catch (e) {
      status.error = e.message;
      if (e.code === "bad_token") return false;
    }
    connect();
    return true;
  },
  stop() {
    stopped = true;
    ws?.close(1000);
  },
};
