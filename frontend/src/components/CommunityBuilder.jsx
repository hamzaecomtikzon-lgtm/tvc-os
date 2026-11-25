import { useEffect, useRef, useState } from "react";
import { useApp } from "../context/app.js";
import { api } from "../services/api.js";
import { MOD_CATEGORY, PERMS, baseName, cleanChannelName, slotName, templateLabel } from "../lib/setup.js";
import { TEMPLATES, automationCount, channelCount, suggestTemplate } from "../lib/communityTemplates.js";
import { Icon } from "./site.jsx";

/**
 * AI Community Builder. Step 1: pick one of the ready-made server layouts, or describe the
 * community and have the AI design one. Step 2: preview it category by category, rename or
 * switch off channels, then create the missing ones.
 * `onCreate(channels)` receives `[{ name, category, perm, auto }]` for the new channels.
 */
export default function CommunityBuilder({ guild, brand, onCreate, onClose }) {
  const { conn } = useApp();
  const existing = new Set(guild.channels.map((c) => baseName(c.name)));
  const [tpl, setTpl] = useState(null); // the chosen template, or an AI design
  const [cats, setCats] = useState([]);
  const [prompt, setPrompt] = useState(`Creator community for ${brand || "our brand"}, a TikTok Shop brand. Creators post videos and earn commission.`);
  const [designing, setDesigning] = useState(false);
  const [aiError, setAiError] = useState("");
  const [slide, setSlide] = useState(0);
  const [progress, setProgress] = useState(-1); // -1 editing, otherwise index of the channel being created
  const track = useRef(null);
  const timers = useRef([]);
  const suggested = suggestTemplate(prompt);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && progress < 0 && !designing) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, progress, designing]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));

  /** Open a layout in the editor: every channel switched on, the ones the server already has marked. */
  const choose = (t) => {
    setTpl(t);
    setCats(t.cats.map((c) => ({ ...c, ch: c.ch.map((x) => ({ ...x, on: true, exists: existing.has(x.name) })) })));
    setSlide(0);
    requestAnimationFrame(() => track.current?.scrollTo({ left: 0 }));
  };
  const design = async () => {
    setDesigning(true);
    setAiError("");
    try {
      const out = await api("POST", "/ai/community", { description: prompt });
      choose({ id: "ai", icon: "✨", name: out.name, tagline: out.tagline, cats: out.cats, ai: true });
    } catch (e) {
      setAiError(e.message);
    } finally {
      setDesigning(false);
    }
  };

  const kept = new Set(cats.flatMap((c) => c.ch.map((x) => x.name)));
  const extra = guild.channels.filter((c) => !kept.has(baseName(c.name)));
  const todo = cats.flatMap((c) => c.ch.filter((x) => x.on && !x.exists).map((x) => ({
    name: templateLabel({ ...x, name: x.name || "channel" }), category: c.cat === MOD_CATEGORY ? "No category" : c.cat, perm: x.perm, auto: x.auto,
  })));

  const patch = (i, j, change) => setCats((cs) => cs.map((c, ci) => (ci !== i ? c : { ...c, ch: c.ch.map((x, xi) => (xi !== j ? x : { ...x, ...change })) })));
  const goTo = (i) => {
    const n = Math.max(0, Math.min(cats.length - 1, i));
    setSlide(n);
    track.current?.scrollTo({ left: track.current.clientWidth * n });
  };
  const scrollT = useRef(0);
  const onScroll = () => {
    clearTimeout(scrollT.current);
    scrollT.current = setTimeout(() => {
      const el = track.current;
      if (el) setSlide(Math.round(el.scrollLeft / el.clientWidth));
    }, 80);
  };

  const create = () => {
    const tick = (i) => {
      setProgress(i);
      if (i < todo.length) later(() => tick(i + 1), 150);
      else later(() => onCreate(todo), 450);
    };
    tick(0);
  };

  const creating = progress >= 0;
  const newIn = (t) => t.cats.reduce((n, c) => n + c.ch.filter((x) => !existing.has(x.name)).length, 0);

  return (
    <div className="k-dlg" role="dialog" aria-modal="true" aria-labelledby="builderTitle">
      <div className="k-builder">
        <header>
          <span className="k-ai"><Icon name="spark" /></span>
          <div>
            <h3 id="builderTitle">AI Community Builder</h3>
            <span className="k-micro">{!tpl ? `Pick a layout for ${guild.guildName}, or describe your community and let the AI design one` : `Preview for ${guild.guildName} · swipe through each category, rename or switch off anything`}</span>
          </div>
          {!creating && <button className="k-btn sm ghost k-x" type="button" onClick={onClose} aria-label="Close"><Icon name="x" /></button>}
        </header>

        {creating ? (
          <div className="k-creating">
            <h4>Building {guild.guildName}</h4>
            <p className="k-p">Creating {todo.length} channels and setting permissions</p>
            {todo.map((x, i) => (
              <div className="k-line" key={x.name + i}>
                <span className={"k-s" + (i < progress ? " ok" : i === progress ? " spin" : "")}>{i < progress && <Icon name="check" size={12} />}</span>
                <span>#{x.name}</span>
                <span className="k-micro" style={{ marginLeft: "auto" }}>{PERMS[x.perm]}</span>
              </div>
            ))}
          </div>
        ) : !tpl ? (
          /* ---------- step 1: choose a template ---------- */
          <>
            <div className="k-prompt">
              <input className="k-input" value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="Describe your community" placeholder="Describe your community: who the creators are, what they sell, how you run it" />
              <button className="k-btn subtle" type="button" onClick={design} disabled={designing || !conn.ai || prompt.trim().length < 10} title={conn.ai ? "" : "Add ANTHROPIC_API_KEY to backend/.env to use the AI designer"}>
                {designing ? <><span className="k-typing"><i /><i /><i /></span>Designing</> : <><Icon name="spark" />Design with AI</>}
              </button>
            </div>
            <div className="k-tpls">
              {aiError && <p className="k-tpl-err" role="alert">{aiError}</p>}
              {!conn.ai && <p className="k-micro">The AI designer is off on this server, so pick one of the ready-made layouts below.</p>}
              <div className="k-tpl-grid">
                {TEMPLATES.map((t) => {
                  const fresh = newIn(t);
                  return (
                    <button key={t.id} type="button" className={"k-tpl" + (suggested?.id === t.id ? " match" : "")} onClick={() => choose(t)}>
                      <div className="k-tpl-top">
                        <span className="k-tpl-ic" aria-hidden="true">{t.icon}</span>
                        <div style={{ minWidth: 0 }}>
                          <b>{t.name}</b>
                          <span className="k-micro">{t.bestFor}</span>
                        </div>
                        {suggested?.id === t.id && <span className="k-pill rose k-tpl-tag">Fits your description</span>}
                      </div>
                      <p>{t.tagline}</p>
                      <div className="k-tpl-cats">{t.cats.map((c) => <span key={c.cat}>{c.cat}</span>)}</div>
                      <div className="k-tpl-meta">
                        <span>{t.cats.length} categories</span><span>{channelCount(t.cats)} channels</span><span>{automationCount(t.cats)} automations</span>
                        {fresh < channelCount(t.cats) && <span>{fresh} new</span>}
                        <span className="k-tpl-go">Preview <Icon name="arrow" size={14} /></span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            <footer>
              <span className="k-micro">Every layout includes the channels your automations post in, and a private moderators area for approvals. You can rename or switch off any channel next.</span>
              <div className="k-r"><button className="k-btn" type="button" onClick={onClose}>Cancel</button></div>
            </footer>
          </>
        ) : (
          /* ---------- step 2: preview and edit ---------- */
          <>
            <div className="k-prompt k-tplbar">
              <span className="k-tpl-ic sm" aria-hidden="true">{tpl.icon}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <b>{tpl.name}</b>{tpl.ai && <span className="k-pill" style={{ marginLeft: 8 }}>Designed by AI</span>}
                <div className="k-micro">{tpl.tagline}</div>
              </div>
              {tpl.ai && <button className="k-btn subtle sm" type="button" onClick={design} disabled={designing}>{designing ? <><span className="k-typing"><i /><i /><i /></span>Designing</> : <><Icon name="redo" />Try another design</>}</button>}
              <button className="k-btn sm" type="button" onClick={() => setTpl(null)} disabled={designing} title="Go back to the layouts. Changes to this one are not kept."><Icon name="back" />Change template</button>
            </div>
            {aiError && <p className="k-tpl-err" role="alert" style={{ margin: "10px 22px 0" }}>{aiError}</p>}
            <div className="k-bbody">
              <div className="k-dside" aria-label="Server preview">
                <div className="k-srv">{guild.guildName}</div>
                {cats.map((c, i) => (
                  <div key={c.cat}>
                    <button type="button" className={"k-cat" + (slide === i ? " cur" : "")} onClick={() => goTo(i)}><span>{c.cat}</span><span>{c.ch.filter((x) => x.on).length}</span></button>
                    {c.ch.filter((x) => x.on).map((x, j) => (
                      <div className={"k-ch" + (x.exists ? "" : " new")} key={j}><Icon name="hash" size={15} /><span>{templateLabel(x)}</span></div>
                    ))}
                  </div>
                ))}
                {extra.length > 0 && <>
                  <div className="k-cat"><span>KEPT AS IS</span><span>{extra.length}</span></div>
                  {extra.map((c) => <div className="k-ch" key={c.id}><Icon name="hash" size={15} /><span>{c.name}</span></div>)}
                </>}
              </div>
              <div className="k-bright">
                <div className="k-bnav">
                  <div className="k-dots">
                    {cats.map((c, i) => <button type="button" key={c.cat} className={slide === i ? "on" : ""} onClick={() => goTo(i)}>{c.cat}</button>)}
                  </div>
                  <div className="k-arrows">
                    <button className="k-btn sm" type="button" onClick={() => goTo(slide - 1)} aria-label="Previous category"><Icon name="back" /></button>
                    <button className="k-btn sm" type="button" onClick={() => goTo(slide + 1)} aria-label="Next category"><Icon name="arrow" /></button>
                  </div>
                </div>
                <div className="k-track" ref={track} onScroll={onScroll}>
                  {cats.map((c, i) => (
                    <section className="k-slide" key={c.cat} aria-label={c.cat}>
                      <div className="k-sh">
                        <h4>{c.cat}</h4>
                        {c.priv && <span className="k-pill rose">Private to mods</span>}
                        <p>{c.about}</p>
                      </div>
                      {c.ch.map((x, j) => (
                        <div className={"k-chrow" + (x.on ? "" : " off")} key={j}>
                          <input type="checkbox" checked={x.on} disabled={x.exists} onChange={(e) => patch(i, j, { on: e.target.checked })} aria-label={"Include #" + x.name} />
                          <div style={{ minWidth: 0 }}>
                            <div className="k-nm">
                              <span className="k-hash">#{x.e ? x.e + "・" : ""}</span>
                              <input
                                type="text" value={x.name} disabled={x.exists} aria-label="Channel name"
                                onChange={(e) => patch(i, j, { name: cleanChannelName(e.target.value) })}
                                onBlur={() => { if (!x.name) patch(i, j, { name: "channel" }); }}
                              />
                              {x.exists && <span className="k-pill line">Already exists</span>}
                              {x.auto && <span className="k-pill">{slotName(x.auto)}</span>}
                            </div>
                            <div className="k-desc">{x.desc}</div>
                          </div>
                          <select className="k-input" value={x.perm} disabled={x.exists} onChange={(e) => patch(i, j, { perm: e.target.value })} aria-label={"Who can post in #" + x.name}>
                            {Object.entries(PERMS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                          </select>
                        </div>
                      ))}
                    </section>
                  ))}
                </div>
              </div>
            </div>
            <footer>
              <span className="k-micro">Template: {tpl.name}. New channels are added; channels you already have are kept as they are.</span>
              <div className="k-r">
                <button className="k-btn" type="button" onClick={onClose}>Cancel</button>
                <button className="k-btn primary" type="button" onClick={create} disabled={!todo.length || designing}>
                  <Icon name="spark" />{todo.length ? `Create ${todo.length} channel${todo.length === 1 ? "" : "s"}` : "Nothing new to create"}
                </button>
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
