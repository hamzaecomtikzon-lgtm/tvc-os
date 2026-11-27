/*
 * "Add KREO to your server": the official KREO bot, separate from the brand's own bot.
 * The company never handles a token. They click once, Discord opens with their server already
 * picked, they press Authorize, and this updates by itself when KREO arrives.
 * Renders nothing when KREO isn't set up on the platform yet.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../services/api.js";

const POLL_MS = 4000, POLL_FOR = 3 * 60_000;

export function useKreoConnection() {
  const [k, setK] = useState(null);
  const [waiting, setWaiting] = useState(false);
  const until = useRef(0);
  const load = useCallback(async (fresh) => {
    try {
      const r = await api("GET", "/kreo-connection" + (fresh ? "?fresh=1" : ""));
      setK(r);
      return r;
    } catch {
      return null;
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  // After "Add KREO", check every few seconds (and whenever the tab comes back) until it's there.
  useEffect(() => {
    if (!waiting) return;
    const tick = async () => {
      const r = await load(true);
      if (r?.inGuild || Date.now() > until.current) setWaiting(false);
    };
    const id = setInterval(tick, POLL_MS);
    window.addEventListener("focus", tick);
    return () => { clearInterval(id); window.removeEventListener("focus", tick); };
  }, [waiting, load]);
  const start = () => { until.current = Date.now() + POLL_FOR; setWaiting(true); };
  return { k, waiting, start, refresh: () => load(true) };
}

const Avatar = ({ k, size = 40 }) => (
  <span className="kc-av" style={{ width: size, height: size }}>
    {k.bot?.avatar ? <img src={k.bot.avatar} alt="" /> : "K"}
  </span>
);

/** Settings → Discord card. */
export function KreoCard({ isAdmin, Ico }) {
  const { k, waiting, start, refresh } = useKreoConnection();
  if (!k?.available) return null;
  const name = k.bot?.name || "KREO";
  const state = k.inGuild ? ["good", "Added"] : waiting ? ["", "Waiting for Discord…"] : k.inGuild === false ? ["line", "Not added yet"] : ["line", "Couldn’t check"];
  return (
    <section className="card2">
      <div className="h"><h3>Official {name} bot</h3><p>{name}’s own bot, separate from yours. It messages your creators from {name} (for example to invite them to join on {name}), in its own DM conversation next to your bot’s.</p></div>
      <div className="kc-row">
        <Avatar k={k} />
        <div className="kc-txt">
          <b>{name} <span className="kc-app">APP</span></b>
          <span>{k.inGuild ? `In your server. Nothing else to set up.` : !k.guildId ? "Connect your own bot to a server first." : "Not in your server yet. Takes one click; you never need a token."}</span>
        </div>
        <span className={"pill " + state[0]} style={{ marginLeft: "auto", flex: "none" }}>{k.inGuild && Ico ? <Ico name="check" /> : null}{state[1]}</span>
      </div>
      {k.guildId && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!k.inGuild && k.inviteUrl && (
            <a className={"btn primary" + (isAdmin ? "" : " disabled")} href={isAdmin ? k.inviteUrl : undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!isAdmin} onClick={(e) => (isAdmin ? start() : e.preventDefault())}>
              {Ico && <Ico name="plus" />}Add {name} to your server
            </a>
          )}
          <button className="btn" type="button" onClick={refresh}>{Ico && <Ico name="redo" />}Check again</button>
        </div>
      )}
      {!k.inGuild && k.guildId && <small className="muted" style={{ fontSize: "var(--text-micro)" }}>{isAdmin ? "Discord opens with your server already picked: press Authorize, then come back. Needs the Manage Server permission in Discord. It only gets permission to read and send messages: it can’t change channels, roles or settings." : "Ask the workspace owner or an admin to add it."}</small>}
    </section>
  );
}

/** The step in first-run setup, shown once the brand's bot is in the server. Optional. */
export function KreoSetupRow({ Icon }) {
  const { k, waiting, start, refresh } = useKreoConnection();
  if (!k?.available || !k.guildId) return null;
  const name = k.bot?.name || "KREO";
  return (
    <div className="k-connected kc-setup" style={{ marginTop: 10 }}>
      <Avatar k={k} size={32} />
      <div style={{ minWidth: 0 }}>
        {k.inGuild
          ? <><b>{name}</b> is in your server too. Creators will get {name}’s messages in a separate DM.</>
          : <><b>Also add the official {name} bot</b> <span className="k-micro">(recommended)</span><div className="k-micro">{waiting ? "Waiting for you to press Authorize in Discord. This updates by itself." : `One click, your server is already picked. ${name} only reads and sends messages.`}</div></>}
      </div>
      {k.inGuild
        ? <span style={{ marginLeft: "auto", display: "inline-flex" }}><Icon name="check" /></span>
        : waiting
        ? <button className="k-btn sm" type="button" style={{ marginLeft: "auto" }} onClick={refresh}><Icon name="redo" />Refresh</button>
        : <a className="k-btn sm subtle" style={{ marginLeft: "auto" }} href={k.inviteUrl} target="_blank" rel="noopener noreferrer" onClick={start}>Add {name} <Icon name="external" /></a>}
    </div>
  );
}
