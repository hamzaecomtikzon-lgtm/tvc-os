/*
 * Discord gateway: one WebSocket per bot that delivers live events (members joining,
 * DMs, messages, reactions, voice) to `onEvent(type, data)`. Reconnects and
 * resumes on its own. https://discord.com/developers/docs/events/gateway
 *
 * createGateway() makes an independent connection for any bot client: the brand bot and
 * the official KREO bot each have their own socket, session, heartbeat and status, so
 * stopping or restarting one never touches the other.
 */
import { discord } from "./discord.js";

const URL0 = process.env.DISCORD_GATEWAY_URL || "wss://gateway.discord.gg";
const QUERY = "/?v=10&encoding=json";
export const INTENT = {
  GUILDS: 1 << 0, MEMBERS: 1 << 1, VOICE: 1 << 7, MESSAGES: 1 << 9, REACTIONS: 1 << 10, DMS: 1 << 12, CONTENT: 1 << 15,
};
const BRAND_INTENTS = INTENT.GUILDS | INTENT.VOICE | INTENT.MESSAGES | INTENT.REACTIONS | INTENT.DMS;

/**
 * A gateway connection for `client` (from createDiscord). `baseIntents` are always asked for; the
 * privileged Server Members and Message Content intents are added when the Developer Portal has them on.
 * `offVar` names an env var that, set to "off", keeps this connection from starting.
 */
export function createGateway(client, { baseIntents = BRAND_INTENTS, offVar = "DISCORD_GATEWAY", browser = "kreo" } = {}) {
  /** What the UI shows: is the bot listening, and with which optional powers. */
  const status = { connected: false, members: false, content: false, error: null, since: null };

  let ws = null, seq = null, sessionId = null, resumeUrl = null, beat = null, acked = true, retry = 0, onEvent = () => {}, stopped = true, timer = null;

  const send = (op, d) => ws?.readyState === 1 && ws.send(JSON.stringify({ op, d }));
  const intents = () => baseIntents | (status.members ? INTENT.MEMBERS : 0) | (status.content ? INTENT.CONTENT : 0);

  function connect() {
    if (stopped) return;
    const resuming = Boolean(sessionId && resumeUrl);
    const sock = (ws = new WebSocket((resuming ? resumeUrl : URL0) + QUERY));

    sock.onmessage = (e) => {
      if (sock !== ws) return; // an old socket still talking after a restart
      const p = JSON.parse(e.data);
      if (p.s != null) seq = p.s;
      if (p.op === 10) {
        clearInterval(beat);
        acked = true;
        const pulse = () => {
          if (!acked) return sock.close(4000); // the connection went quiet: start over
          acked = false;
          send(1, seq);
        };
        setTimeout(pulse, p.d.heartbeat_interval * Math.random());
        beat = setInterval(pulse, p.d.heartbeat_interval);
        if (resuming) send(6, { token: client.token(), session_id: sessionId, seq });
        else send(2, { token: client.token(), intents: intents(), properties: { os: process.platform, browser, device: browser } });
      } else if (p.op === 11) acked = true;
      else if (p.op === 1) send(1, seq);
      else if (p.op === 7) sock.close(4000);
      else if (p.op === 9) {
        if (!p.d) sessionId = null;
        sock.close(4000);
      } else if (p.op === 0) {
        if (p.t === "READY") {
          sessionId = p.d.session_id;
          resumeUrl = p.d.resume_gateway_url;
        }
        if (p.t === "READY" || p.t === "RESUMED") {
          retry = 0;
          status.connected = true;
          status.error = null;
          status.since ||= new Date().toISOString();
        }
        Promise.resolve().then(() => onEvent(p.t, p.d)).catch((err) => console.error(`[gateway ${browser} ${p.t}]`, err));
      }
    };

    sock.onclose = (e) => {
      if (sock !== ws) return;
      clearInterval(beat);
      status.connected = false;
      status.since = null;
      if (stopped) return;
      if (e.code === 4004) return void (status.error = "Discord rejected the bot token.");
      if (e.code === 4014) {
        // An intent we asked for isn't switched on for this bot: carry on without the optional ones.
        if (!status.members && !status.content) return void (status.error = "Discord refused the bot’s connection settings.");
        status.members = status.content = false;
        sessionId = null;
      }
      if ([4007, 4009].includes(e.code)) sessionId = null;
      timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry++));
    };
    sock.onerror = () => {};
  }

  const gw = {
    status,
    /** Start listening. Does nothing without a bot token, or when the off switch is set. */
    async start(handler) {
      if (handler) onEvent = handler;
      if (!client.configured() || process.env[offVar] === "off") return false;
      // A test API without a test gateway would connect a second listener to the real bot.
      if (process.env.DISCORD_API_BASE && !process.env.DISCORD_GATEWAY_URL) return false;
      if (!stopped) return true;
      stopped = false;
      status.error = null;
      try {
        Object.assign(status, await client.intents());
      } catch (e) {
        status.error = e.message;
        if (e.code === "bad_token") {
          stopped = true;
          return false;
        }
      }
      connect();
      return true;
    },
    /** Disconnect this bot only. */
    stop() {
      stopped = true;
      clearTimeout(timer);
      clearInterval(beat);
      sessionId = resumeUrl = null;
      seq = null;
      const old = ws;
      ws = null;
      old?.close(1000);
      status.connected = false;
      status.since = null;
    },
    /** Disconnect and connect again with a fresh session (picks up a changed token or new intents). */
    async restart() {
      gw.stop();
      client.reset?.();
      retry = 0;
      return gw.start();
    },
    get running() { return !stopped; },
  };
  return gw;
}

/** The brand bot's connection. */
export const gateway = createGateway(discord);
export const status = gateway.status;
