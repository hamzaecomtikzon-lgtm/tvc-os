import { useState } from "react";
import { useApp } from "../context/app.js";
import { AUTOS, INSTALL_URL } from "../lib/constants.js";
import { fmtTime } from "../lib/format.js";
import { Callout, ChanSelect, Empty, Hero } from "../components/ui.jsx";

export default function Wizard() {
  const { guild, ws, allow, shops } = useApp();
  const [step, setStep] = useState(() => (!guild ? 1 : ws.channelsDone ? 3 : 2));
  const s1 = !!guild;
  const s2 = !!(allow?.channels?.length && ws.channelsDone);
  const s3 = !!ws.shopId;

  return (
    <>
      <Hero eyebrow="Setup" title="Get started" lede="Three steps to connect your Discord server and TikTok Shop data." />
      <div className="wiz">
        <div className="steps">
          <Step n={1} current={step} done={s1} label="Add the Discord bot" sub={s1 ? guild.guildName : "Install it in your server"} />
          <Step n={2} current={step} done={s2} label="Assign channels" sub={s2 ? `${allow.channels.length} channels allowed` : "One channel per automation"} />
          <Step n={3} current={step} done={s3} label="Connect Cruva" sub={s3 ? shops.find((s) => s.id === ws.shopId)?.name || "Connected" : "Pick the brand to pull data from"} />
        </div>
        <section className="card" style={{ minWidth: 0 }}>
          {step === 1 && <StepBot onNext={() => setStep(2)} />}
          {step === 2 && <StepChannels onBack={() => setStep(1)} onNext={() => setStep(3)} />}
          {step === 3 && <StepCruva onBack={() => setStep(2)} />}
        </section>
      </div>
    </>
  );
}

function Step({ n, current, done, label, sub }) {
  return (
    <div className={"step " + (current === n ? "now" : done ? "done" : "todo")}>
      <span className="ndisc">{done && current !== n ? "✓" : "0" + n}</span>
      <div><b>{label}</b><div className="muted">{sub}</div></div>
    </div>
  );
}

function StepBot({ onNext }) {
  const { guilds, gid, guild, request, saveWs, toast } = useApp();
  const [checking, setChecking] = useState(false);

  const find = async () => {
    setChecking(true);
    if (await request("sync", {})) toast("Asked Claude to check Discord. Your server appears here in a few seconds.");
    setTimeout(() => setChecking(false), 4000);
  };

  return (
    <>
      <p className="big">Add the bot to Discord</p>
      <p className="muted">Install the bot with the permissions it needs, then let Claude find your server.</p>
      <div className="row-actions" style={{ margin: "14px 0" }}>
        <a className="btn primary" href={INSTALL_URL} target="_blank" rel="noopener noreferrer">Add To Discord ↗</a>
        <button className="btn" onClick={find} disabled={checking}>{checking ? "Checking…" : "I’ve Added It, Find My Server"}</button>
      </div>
      <h3 style={{ marginTop: 18 }}>Servers the bot is in</h3>
      {guilds.length ? (
        <div className="rows">
          {guilds.map((x) => (
            <div key={x.guildId}>
              <span className="disc" style={{ width: 34, height: 34, fontSize: 11 }} aria-hidden="true">{x.guildName.slice(0, 2).toUpperCase()}</span>
              <span className="grow"><b>{x.guildName}</b><span className="muted" style={{ display: "block" }}>{x.channels.length} text channels · checked {fmtTime(x.syncedAt)}</span></span>
              <button className={"btn sm" + (gid === x.guildId ? " primary" : "")} onClick={() => saveWs({ guildId: x.guildId })}>
                {gid === x.guildId ? "Selected" : "Use This Server"}
              </button>
            </div>
          ))}
        </div>
      ) : <Empty title="No servers found yet">Add the bot, then press “Find my server”.</Empty>}
      <div className="foot" style={{ marginTop: 14 }}>
        <span className="muted">Step 1 of 3</span>
        <button className="btn primary" disabled={!guild} onClick={onNext}>Next: Channels →</button>
      </div>
    </>
  );
}

function StepChannels({ onBack, onNext }) {
  const { autos, cfg, saveCfg, saveAutos, saveWs, toast } = useApp();
  const [map, setMap] = useState(() => Object.fromEntries(AUTOS.map((a) => [a.key, autos[a.key].channel])));
  const [mod, setMod] = useState(cfg.modChannel);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const next = {};
    AUTOS.forEach((a) => (next[a.key] = { ...autos[a.key], channel: map[a.key], enabled: !!map[a.key] }));
    const nextCfg = { ...cfg, modChannel: mod };
    const ok = (await saveCfg(nextCfg, { sync: false })) && (await saveAutos(next, nextCfg));
    if (ok && (await saveWs({ channelsDone: true }))) {
      toast("Channels saved and sent to the allowlist");
      onNext();
    }
    setSaving(false);
  };

  return (
    <>
      <p className="big">Choose channels</p>
      <p className="muted">We matched channels by name. Change any of them, or pick “Off” to skip an automation.</p>
      <div>
        {AUTOS.map((a) => (
          <div key={a.key} className="maprow">
            <div><b>{a.name}</b><div className="muted">{a.what}</div></div>
            <ChanSelect value={map[a.key]} onChange={(v) => setMap({ ...map, [a.key]: v })} allowNone />
          </div>
        ))}
        <div className="maprow">
          <div><b>Mod channel</b><div className="muted">Test posts and flagged messages go here.</div></div>
          <ChanSelect value={mod} onChange={setMod} />
        </div>
      </div>
      <div className="foot" style={{ marginTop: 14 }}>
        <button className="btn ghost" onClick={onBack}>← Back</button>
        <button className="btn primary" onClick={save} disabled={saving}>Save And Allowlist →</button>
      </div>
    </>
  );
}

function StepCruva({ onBack }) {
  const { shops, ws, cruvaOk, setShop, saveWs, toast } = useApp();
  const ok = cruvaOk && shops.length;

  const finish = async () => {
    if (await saveWs({ done: true })) {
      toast("You’re live. Try a test post from Automations.");
      location.hash = "#automations";
    }
  };

  return (
    <>
      <p className="big">Connect Cruva</p>
      {ok ? <>
        <Callout icon="✓" style={{ marginTop: 12 }}><b>Cruva is connected.</b> {shops.length} brands found. Pick the one this server is for.</Callout>
        <div className="rows" style={{ marginTop: 10 }}>
          {shops.map((s) => (
            <div key={s.id}>
              <span className="grow"><b>{s.name}</b><span className="muted" style={{ display: "block" }}>{s.region.toUpperCase()} · {s.plan} plan</span></span>
              <button className={"btn sm" + (ws.shopId === s.id ? " primary" : "")} onClick={async () => { setShop(s.id); await saveWs({ shopId: s.id }); }}>
                {ws.shopId === s.id ? "Selected" : "Use This Brand"}
              </button>
            </div>
          ))}
        </div>
      </> : <>
        <div className="err" style={{ marginTop: 12 }}>Cruva isn’t connected yet. Open Settings → Connectors, add Cruva, then come back and press Check Again.</div>
        <button className="btn" style={{ marginTop: 12 }} onClick={() => location.reload()}>Check Again</button>
      </>}
      <div className="foot" style={{ marginTop: 14 }}>
        <button className="btn ghost" onClick={onBack}>← Back</button>
        <button className="btn primary" disabled={!ws.shopId} onClick={finish}>Finish Setup →</button>
      </div>
    </>
  );
}
