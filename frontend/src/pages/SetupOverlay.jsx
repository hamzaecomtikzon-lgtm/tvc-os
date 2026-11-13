import { useEffect, useRef, useState } from "react";
import { useApp } from "../context/app.js";
import { auth, useAuth } from "../services/auth.js";
import { db } from "../services/db.js";
import { APP_HOME, BRAND } from "../lib/brand.js";
import { AUTOS } from "../lib/constants.js";
import { fmtTime } from "../lib/format.js";
import { CRMS, CRM_CHECKS, SLOTS, STEPS, autoMatch, baseName, readAvatar } from "../lib/setup.js";
import { Icon } from "../components/site.jsx";
import CommunityBuilder from "../components/CommunityBuilder.jsx";

const initials = (s) => s.replace(/[^a-z0-9 ]/gi, " ").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

/**
 * First-run setup shown over the locked dashboard: add the bot, pick channels,
 * connect a CRM. Progress is kept in `workspace/main`, so it survives a reload;
 * the dashboard unlocks when the last step sets `done`.
 */
export default function SetupOverlay() {
  const app = useApp();
  const user = useAuth();
  const { ws, guild, autos, cfg, saveWs, saveCfg, saveAutos } = app;

  const bot = { name: ws.bot?.name ?? `${user?.brand || BRAND} Bot`, avatar: ws.bot?.avatar || "" };
  const botName = bot.name.trim() || `${BRAND} Bot`;
  const map = ws.map || {};
  const crm = ws.crm || { id: null, ok: false };
  const done = { 1: !!guild, 2: !!map.mod, 3: !!crm.ok };
  const nDone = [1, 2, 3].filter((n) => done[n]).length;
  const canOpen = (n) => n === 1 || Array.from({ length: n - 1 }, (_, i) => done[i + 1]).every(Boolean);
  let step = ws.step || 1;
  while (step > 1 && !canOpen(step)) step--;
  const goStep = (n) => saveWs({ step: n });

  /** Write the chosen channels into the automations, the mod channel and the allowlist. */
  const commitChannels = async () => {
    const next = {};
    AUTOS.forEach((a) => (next[a.key] = { ...autos[a.key], channel: map[a.key] || "", enabled: !!map[a.key] }));
    const nextCfg = { ...cfg, botName, modChannel: map.mod || "" };
    return (await saveCfg(nextCfg, { sync: false })) && (await saveAutos(next, nextCfg)) && (await saveWs({ channelsDone: true }));
  };

  const ctx = { ...app, user, bot, botName, map, crm, done, goStep, commitChannels };

  return (
    <div className="site k-overlay" role="dialog" aria-modal="true" aria-labelledby="setupTitle">
      <div className="k-setup">
        <div className="k-srail">
          <div>
            <h2 id="setupTitle">Set up {BRAND}</h2>
            <p>Finish these 3 steps to unlock your dashboard.</p>
          </div>
          <div>
            <div className="k-prog"><i style={{ width: (nDone / 3) * 100 + "%" }} /></div>
            <p className="k-micro" style={{ marginTop: 8 }}>{nDone} of 3 done</p>
          </div>
          <ol className="k-stepper">
            {STEPS.map((st) => (
              <li key={st.n}>
                <button
                  type="button" disabled={!canOpen(st.n)} onClick={() => goStep(st.n)}
                  className={(step === st.n ? "cur " : "") + (done[st.n] ? "done" : "")} aria-current={step === st.n ? "step" : undefined}
                >
                  <span className="k-sn">{done[st.n] ? <Icon name="check" size={16} /> : st.n}</span>
                  <div><b>{st.t}</b><span>{st.s}</span></div>
                </button>
              </li>
            ))}
          </ol>
          <p className="k-help">
            Stuck? Every step can be changed later in Settings.
            {user && <><br />Signed in as {user.email}. <button type="button" className="k-linkbtn" onClick={() => { auth.signOut(); location.hash = "#home"; }}>Sign out</button></>}
          </p>
        </div>
        <div className="k-sbody">
          {step === 1 && <StepBot ctx={ctx} />}
          {step === 2 && <StepChannels ctx={ctx} />}
          {step === 3 && <StepCrm ctx={ctx} />}
        </div>
      </div>
    </div>
  );
}

function Footer({ back, children, note = "Dashboard unlocks after step 3" }) {
  return (
    <div className="k-foot2">
      <span className="k-lockmsg"><Icon name="lock" size={16} /> {note}</span>
      <div className="k-r">
        {back && <button className="k-btn" type="button" onClick={back}><Icon name="back" />Back</button>}
        {children}
      </div>
    </div>
  );
}

function BotAvatar({ bot, botName }) {
  return bot.avatar ? <img src={bot.avatar} alt="" /> : (botName[0] || "K").toUpperCase();
}

/* ---------- Step 1: bot name, picture, server ---------- */
function StepBot({ ctx }) {
  const { ws, guild, guilds, channels, bot, botName, discordInfo, checkDiscord, saveWs, putDoc, requestWait, toast, goStep } = ctx;
  const invite = guild ? "done" : ws.invite || "idle";
  const inviteUrl = discordInfo.inviteUrl;
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(""); // why the last check failed, in words
  const running = useRef(false);

  const setBot = (patch) => saveWs({ bot: { ...bot, ...patch } });

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      await setBot({ avatar: await readAvatar(file) });
      toast("Picture added");
    } catch {
      toast("That file isn’t an image we can read. Try a PNG or JPG.");
    }
  };

  /* Ask the bot which servers it has joined. `quiet` checks run on a timer and don't toast. */
  const checkInvite = async (quiet) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    const r = await requestWait("sync");
    running.current = false;
    setBusy(false);
    if (!r.ok) {
      setProblem(r.error);
      if (r.code === "not_configured" || r.code === "bad_token") checkDiscord();
      return false;
    }
    setProblem("");
    const found = r.result.guilds.length > 0;
    if (!guild) await saveWs({ invite: found ? "found" : "waiting" });
    if (!found && !quiet) toast("We can’t see the bot in a server yet. Finish in Discord, then refresh.");
    return true;
  };

  // After "Add to Discord": look now, again every few seconds, and when the user comes back to this tab.
  const check = useRef(checkInvite);
  useEffect(() => { check.current = checkInvite; });
  useEffect(() => {
    if (invite !== "waiting" || !discordInfo.configured) return;
    check.current(true);
    const timer = setInterval(() => check.current(true), 5000);
    const onFocus = () => check.current(true);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [invite, discordInfo.configured]);

  /* Name and picture are applied in Discord; a refusal there doesn't block setup. */
  const applyProfile = async () => {
    const r = await requestWait("profile", { name: botName, avatar: bot.avatar });
    if (!r.ok) toast(r.error);
    else if (r.result.warning) toast(r.result.warning);
    return r.ok;
  };

  const useServer = async () => {
    const g = guilds.find((x) => x.guildId === (picked || guilds[0]?.guildId));
    if (!g) return;
    setBusy(true);
    const saved = (await saveWs({ guildId: g.guildId, invite: "done", map: autoMatch(g.channels, {}), newChannels: [] }))
      && (await putDoc("config/" + g.guildId, { ...(db.get("config/" + g.guildId) || {}), guild: g.guildId, botName }));
    if (saved && (await applyProfile())) toast(`${botName} is set up in ${g.guildName}`);
    setBusy(false);
  };

  const refresh = async () => {
    if (await checkInvite(true)) toast(`Synced. ${botName} is in ${guild.guildName}`);
  };

  const next = async () => {
    setBusy(true);
    await putDoc("config/" + guild.guildId, { ...(db.get("config/" + guild.guildId) || {}), guild: guild.guildId, botName });
    // Only talk to Discord when the name or picture changed since it was last applied.
    const sig = botName + "|" + bot.avatar.length;
    if (ws.botApplied !== sig && (await applyProfile())) await saveWs({ botApplied: sig });
    setBusy(false);
    goStep(2);
  };

  let inviteBlock;
  if (discordInfo.configured === false) {
    inviteBlock = (
      <div className="k-waitbox">
        <div className="k-wt">
          <span className="k-todo-i"><Icon name="plug" size={16} /></span>
          <div>
            <b>The Discord bot isn’t connected yet</b>
            <span>{discordInfo.error || <>Paste your bot token into <code>backend/.env</code> as <code>DISCORD_BOT_TOKEN</code>, then restart the backend.</>}</span>
          </div>
        </div>
        <div className="k-rowbtns">
          <button className="k-btn subtle" type="button" onClick={async () => { if (!(await checkDiscord()).configured) toast("Still not connected. Restart the backend after saving the token."); }}><Icon name="redo" />Check again</button>
        </div>
      </div>
    );
  } else if (guild) {
    inviteBlock = <>
      <div className="k-connected">
        <Icon name="check" />
        <div style={{ minWidth: 0 }}>
          <b>{botName}</b> is in <b>{guild.guildName}</b> and synced. {BRAND} can see {channels.length} channels.
          {guild.canManageChannels === false && <div className="k-micro" style={{ marginTop: 6 }}>The bot can’t create channels here yet. Give its role Manage Channels in Server Settings → Roles to use the community builder.</div>}
        </div>
        <button className="k-btn sm" type="button" style={{ marginLeft: "auto" }} disabled={busy} onClick={refresh}>
          <Icon name="redo" />Refresh
        </button>
      </div>
      {problem && <p className="k-micro" role="alert" style={{ marginTop: 8 }}>{problem}</p>}
      <p className="k-micro" style={{ marginTop: 8 }}>
        Wrong server? <button type="button" className="k-linkbtn" onClick={() => saveWs({ guildId: "", invite: "waiting", map: {}, channelsDone: false })}>Choose a different one</button>
      </p>
    </>;
  } else if (invite === "found" && guilds.length) {
    inviteBlock = (
      <div className="k-waitbox">
        <div className="k-wt">
          <span className="k-todo-i"><Icon name="check" size={16} /></span>
          <div><b>{discordInfo.bot?.name || botName} is in {guilds.length === 1 ? "your server" : `${guilds.length} servers`}</b><span>Pick the one for this workspace.</span></div>
        </div>
        <div className="k-srvpick">
          {guilds.map((g) => (
            <label className="k-srvopt" key={g.guildId}>
              <input type="radio" name="srv" value={g.guildId} checked={(picked || guilds[0].guildId) === g.guildId} onChange={() => setPicked(g.guildId)} />
              <span className="k-si">{initials(g.guildName)}</span>
              <div><b>{g.guildName}</b><span>{g.channels.length} channels · checked {fmtTime(g.syncedAt)}</span></div>
            </label>
          ))}
        </div>
        <div className="k-rowbtns">
          <button className="k-btn primary" type="button" onClick={useServer} disabled={busy}>Use this server <Icon name="arrow" /></button>
          <button className="k-btn ghost" type="button" onClick={() => checkInvite()} disabled={busy}><Icon name="redo" />Refresh</button>
          {inviteUrl && <a className="k-btn ghost" href={inviteUrl} target="_blank" rel="noopener noreferrer">Add to another server</a>}
        </div>
      </div>
    );
  } else if (invite === "waiting" || invite === "found") {
    inviteBlock = (
      <div className="k-waitbox">
        <div className="k-wt">
          <span className="k-spinner" aria-hidden="true" />
          <div>
            <b>{busy ? "Checking Discord…" : "Waiting for you to finish in Discord"}</b>
            <span>{problem || "In the Discord tab, pick your server and press Authorize. This page checks every few seconds and updates by itself."}</span>
          </div>
        </div>
        <div className="k-rowbtns">
          <button className="k-btn subtle" type="button" onClick={() => checkInvite()} disabled={busy}><Icon name="redo" />I’ve added it, refresh</button>
          {inviteUrl && <a className="k-btn ghost" href={inviteUrl} target="_blank" rel="noopener noreferrer">Open Discord again</a>}
        </div>
      </div>
    );
  } else {
    inviteBlock = (
      <div className="k-ai-cta" style={{ marginTop: 22 }}>
        <div className="k-ai"><Icon name="server" /></div>
        <div><b>Add it to your server</b><span>Opens Discord in a new tab. You pick a server and approve the permissions, then come back here.</span></div>
        <div className="k-rowbtns">
          <a className="k-btn subtle" href={inviteUrl} target="_blank" rel="noopener noreferrer" aria-disabled={!inviteUrl} onClick={(e) => { if (!inviteUrl) return e.preventDefault(); saveWs({ invite: "waiting" }); }}>Add to Discord <Icon name="external" /></a>
          <button className="k-btn ghost" type="button" onClick={() => saveWs({ invite: "waiting" })}>It’s already in my server</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="k-eyebrow">Step 1 of 3</div>
      <h3>Add your bot to Discord</h3>
      <p className="k-intro">This is how the bot shows up to your creators. Use your brand’s name so posts feel like they come from you.</p>
      <div className="k-botgrid">
        <div className="k-stack">
          <label className="k-field">
            Bot name
            <input className="k-input" type="text" maxLength={32} value={bot.name} placeholder="Glow Lab Bot" onChange={(e) => setBot({ name: e.target.value })} />
            <small>Set as the bot’s nickname in your server. Change it any time.</small>
          </label>
          <div className="k-field">
            Profile picture
            <div className="k-upload">
              <div className={"k-pic" + (bot.avatar ? " has" : "")}>{bot.avatar ? <img src={bot.avatar} alt="Bot picture" /> : <Icon name="upload" />}</div>
              <div className="k-btns">
                <div className="k-rowbtns">
                  <label className="k-btn sm" htmlFor="bot-file">{bot.avatar ? "Change picture" : "Upload picture"}</label>
                  {bot.avatar && <button className="k-btn sm ghost" type="button" onClick={() => setBot({ avatar: "" })}>Remove</button>}
                </div>
                <small>Square PNG or JPG. No picture yet? Skip it and add one later.</small>
              </div>
              <input type="file" id="bot-file" accept="image/png,image/jpeg,image/webp" onChange={onFile} />
            </div>
          </div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="k-field" style={{ marginBottom: 6 }}>Preview</div>
          <div className="k-dc">
            <div className="k-chan"><Icon name="hash" size={16} />🏆・share-wins</div>
            <div className="k-msg">
              <div className="k-av"><BotAvatar bot={bot} botName={botName} /></div>
              <div style={{ minWidth: 0 }}>
                <div className="k-who">{botName} <small>APP</small> <time>Today at 9:00 AM</time></div>
                <div><span className="k-mention">@lena.tries</span> just made her <b>first sale</b>. Welcome to the club 🎉</div>
                <div className="k-reacts"><span>🔥 6</span><span>🤍 4</span><span>🚀 3</span><span>📈 2</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {inviteBlock}
      <Footer>
        <button className="k-btn primary" type="button" disabled={!guild || busy} onClick={next}>Continue <Icon name="arrow" /></button>
      </Footer>
    </>
  );
}

/* ---------- Step 2: one channel per automation ---------- */
function StepChannels({ ctx }) {
  const { ws, guild, channels, user, map, saveWs, requestWait, toast, goStep, commitChannels } = ctx;
  const [building, setBuilding] = useState(false);
  const [saving, setSaving] = useState(false);
  const sparse = channels.length < 6;

  const groups = [];
  channels.forEach((c) => {
    const cat = c.category || "No category";
    let g = groups.find((x) => x[0] === cat);
    if (!g) groups.push((g = [cat, []]));
    g[1].push(c);
  });
  const nameOf = (id) => channels.find((c) => c.id === id)?.name || "";

  const setSlot = (key, id) => {
    const next = { ...map };
    if (id) next[key] = id;
    else delete next[key];
    saveWs({ map: next });
  };

  /* The bot creates the channels in Discord, then each automation is pointed at its new channel. */
  const onCreate = async (todo) => {
    const r = await requestWait("create_channels", { channels: todo });
    setBuilding(false);
    if (!r.ok) return toast(r.error);
    const all = r.result.guild.channels;
    const nextMap = { ...map };
    SLOTS.forEach((s) => {
      const want = todo.find((x) => x.auto === s.key);
      const hit = want && all.find((c) => baseName(c.name) === baseName(want.name));
      if (hit) nextMap[s.key] = hit.id;
    });
    await saveWs({ map: autoMatch(all, nextMap), newChannels: [...(ws.newChannels || []), ...r.result.created] });
    toast(r.result.created.length ? `${r.result.created.length} channels created in ${guild.guildName}` : "Those channels already exist. Nothing was created.");
  };

  const next = async () => {
    setSaving(true);
    if (await commitChannels()) goStep(3);
    setSaving(false);
  };

  return (
    <>
      <div className="k-eyebrow">Step 2 of 3</div>
      <h3>Choose where each automation posts</h3>
      <p className="k-intro">{BRAND} found {channels.length} channels in {guild.guildName}. {sparse ? "That’s not enough for every automation yet." : "We matched the ones that fit."}</p>
      <div className="k-ai-cta">
        <div className="k-ai"><Icon name="spark" /></div>
        <div>
          <b>AI Community Builder</b>
          <span>{sparse ? "Your server is new. Preview a full creator community and create every channel, with permissions, in one click." : "Want the full layout? Preview the creator community template and add what’s missing."}</span>
        </div>
        <button className={"k-btn " + (sparse ? "primary" : "subtle")} type="button" onClick={() => setBuilding(true)}><Icon name="spark" />Build my community</button>
      </div>
      <div className="k-maphead">
        <b>Channels per automation</b>
        <button className="k-btn sm ghost" type="button" onClick={() => { saveWs({ map: autoMatch(channels, {}, true) }); toast("Channels matched"); }}><Icon name="redo" />Auto-match again</button>
      </div>
      <div className="k-maptable">
        {SLOTS.map((s) => (
          <div className="k-maprow" key={s.key}>
            <div style={{ minWidth: 0 }}>
              <b>
                {s.name}
                {s.req && <span className="k-pill rose">Required</span>}
                {map[s.key] && s.hint.includes(baseName(nameOf(map[s.key]))) && <span className="k-pill good">Matched</span>}
              </b>
              <span>{s.what}</span>
            </div>
            <select className="k-input" value={map[s.key] || ""} onChange={(e) => setSlot(s.key, e.target.value)} aria-label={"Channel for " + s.name}>
              <option value="">Off for now</option>
              {groups.map(([cat, chs]) => (
                <optgroup key={cat} label={cat}>
                  {chs.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
        ))}
      </div>
      <Footer back={() => goStep(1)}>
        <button className="k-btn primary" type="button" disabled={!map.mod || saving} onClick={next}>Continue <Icon name="arrow" /></button>
      </Footer>
      {building && <CommunityBuilder guild={guild} brand={user?.brand} onCreate={onCreate} onClose={() => setBuilding(false)} />}
    </>
  );
}

/* ---------- Step 3: CRM and launch ---------- */
function StepCrm({ ctx }) {
  const { ws, guild, channels, shops, bot, botName, map, crm, saveWs, setShop, toast, goStep, commitChannels } = ctx;
  const c = CRMS.find((x) => x.id === crm.id);
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [hint, setHint] = useState("");
  const [checking, setChecking] = useState(-1); // index of the running check
  const [launching, setLaunching] = useState(false);
  const input = useRef(null);
  const timers = useRef([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const pick = (id) => {
    setKey("");
    setHint("");
    saveWs({ crm: { id, ok: false } });
    setTimeout(() => input.current?.focus(), 0);
  };

  /* Live CRM sync isn't built yet: the key isn't sent anywhere and the dashboard shows sample data. */
  const connect = () => {
    if (!key.trim()) {
      setHint("Paste your API key first");
      return input.current?.focus();
    }
    const tick = (i) => {
      setChecking(i);
      if (i < CRM_CHECKS.length) return timers.current.push(setTimeout(() => tick(i + 1), 550));
      timers.current.push(setTimeout(async () => {
        const shopId = ws.shopId || shops[0]?.id || "";
        if (shopId) setShop(shopId);
        await saveWs({ crm: { id: c.id, ok: true }, shopId });
        setChecking(-1);
        setKey("");
        toast(`${c.name} connected`);
      }, 300));
    };
    tick(0);
  };

  const change = () => saveWs({ crm: { id: crm.id, ok: false } });
  const modName = channels.find((x) => x.id === map.mod)?.name || "";
  const withChannel = SLOTS.filter((s) => s.key !== "mod" && map[s.key]).length;
  const created = ws.newChannels?.length || 0;

  const launch = async () => {
    setLaunching(true);
    if ((await commitChannels()) && (await saveWs({ done: true, step: 1 }))) {
      toast(`${BRAND} is live in ${guild.guildName}. Drafts land in #${modName}.`);
      location.hash = "#" + APP_HOME;
    } else setLaunching(false);
  };

  return (
    <>
      <div className="k-eyebrow">Step 3 of 3</div>
      <h3>Connect your CRM</h3>
      <p className="k-intro">{BRAND} reads your creators, videos and sales from the CRM you already use. Pick yours and paste an API key.</p>

      {!crm.ok && (
        <div className="k-crms">
          {CRMS.map((x) => (
            <button type="button" key={x.id} className={"k-crm" + (crm.id === x.id ? " on" : "")} aria-pressed={crm.id === x.id} onClick={() => pick(x.id)} disabled={checking >= 0}>
              <span className="k-mk">{x.mono}</span><b>{x.name}</b><span>{x.reads}</span>
            </button>
          ))}
        </div>
      )}

      {c && !crm.ok && (
        <div className="k-keybox">
          <label className="k-field" htmlFor="crm-key">{c.name} API key<small>{c.how}</small></label>
          <div className="k-keyrow">
            <input
              className="k-input" id="crm-key" ref={input} type={show ? "text" : "password"} value={key} autoComplete="off" spellCheck={false}
              placeholder={hint || `${c.id}_live_••••••••••••••••`} disabled={checking >= 0}
              onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") connect(); }}
            />
            <button className="k-btn" type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide key" : "Show key"} aria-pressed={show}><Icon name={show ? "eyeOff" : "eye"} /></button>
            <button className="k-btn primary" type="button" onClick={connect} disabled={checking >= 0}><Icon name="plug" />Connect</button>
          </div>
          <p className="k-micro">{BRAND} only reads data. It never changes anything in {c.name}. Live {c.name} sync isn’t connected yet: your key isn’t stored, and the dashboard shows sample data for now.</p>
          {checking >= 0 && (
            <div className="k-checks">
              {CRM_CHECKS.map((label, i) => (
                <div key={label}><span className={"k-s" + (i < checking ? " ok" : i === checking ? " spin" : "")}>{i < checking && <Icon name="check" size={12} />}</span>{label}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {c && crm.ok && (
        <>
          <div className="k-connected">
            <Icon name="check" />
            <div><b>{c.name} selected.</b> Until live sync is connected, {BRAND} shows sample creators and sales.</div>
            <button className="k-btn sm" type="button" style={{ marginLeft: "auto" }} onClick={change}>Change</button>
          </div>
          <div className="k-found">
            <div><b>1,284</b><span>Creators in your CRM</span></div>
            <div><b>458</b><span>Linked to Discord</span></div>
            <div><b>$96.4k</b><span>GMV, last 30 days</span></div>
          </div>
          <p className="k-micro" style={{ marginTop: 8 }}>Sample data. Creators show as their @handle in posts.</p>
          <div className="k-summary">
            <div><Icon name="check" /><div><b>Bot</b><span>{botName}{bot.avatar ? "" : " · no picture yet"}</span></div><button className="k-btn sm ghost" type="button" onClick={() => goStep(1)}>Edit</button></div>
            <div><Icon name="check" /><div><b>Server</b><span>{guild.guildName} · {channels.length} channels{created ? `, ${created} created by ${BRAND}` : ""}</span></div><button className="k-btn sm ghost" type="button" onClick={() => goStep(1)}>Edit</button></div>
            <div><Icon name="check" /><div><b>Automations</b><span>{withChannel} of 6 have a channel · approvals in #{modName}</span></div><button className="k-btn sm ghost" type="button" onClick={() => goStep(2)}>Edit</button></div>
            <div><Icon name="check" /><div><b>CRM</b><span>{c.name} · read-only</span></div><button className="k-btn sm ghost" type="button" onClick={change}>Edit</button></div>
          </div>
        </>
      )}

      <Footer back={() => goStep(2)} note={crm.ok ? "All set. Launch to unlock your dashboard." : "Dashboard unlocks after this step"}>
        <button className="k-btn primary" type="button" disabled={!crm.ok || launching} onClick={launch}><Icon name="bolt" />Launch {BRAND}</button>
      </Footer>
    </>
  );
}
