import { useEffect, useRef, useState } from "react";
import { MOD_CATEGORY, PERMS, TEMPLATE, baseName, cleanChannelName, slotName, templateLabel } from "../lib/setup.js";
import { Icon } from "./site.jsx";

/**
 * AI Community Builder: preview the creator-community template for a server,
 * rename or switch off channels, then create the missing ones.
 * `onCreate(channels)` receives `[{ name, category, perm, auto }]` for the new channels.
 */
export default function CommunityBuilder({ guild, brand, onCreate, onClose }) {
  const [cats, setCats] = useState(() => {
    const existing = new Set(guild.channels.map((c) => baseName(c.name)));
    return TEMPLATE.map((c) => ({ ...c, ch: c.ch.map((x) => ({ ...x, on: true, exists: existing.has(x.name) })) }));
  });
  const [prompt, setPrompt] = useState(`Creator community for ${brand || "our brand"}, a TikTok Shop brand. Creators post videos and earn commission.`);
  const [slide, setSlide] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [progress, setProgress] = useState(-1); // -1 editing, otherwise index of the channel being created
  const track = useRef(null);
  const timers = useRef([]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && progress < 0) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, progress]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));

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

  const regenerate = () => {
    setThinking(true);
    later(() => { setThinking(false); goTo(0); }, 1100);
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

  return (
    <div className="k-dlg" role="dialog" aria-modal="true" aria-labelledby="builderTitle">
      <div className="k-builder">
        <header>
          <span className="k-ai"><Icon name="spark" /></span>
          <div>
            <h3 id="builderTitle">AI Community Builder</h3>
            <span className="k-micro">Preview for {guild.guildName} · swipe through each category, rename or switch off anything</span>
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
        ) : (
          <>
            <div className="k-prompt">
              <input className="k-input" value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="Describe your community" />
              <button className="k-btn subtle" type="button" onClick={regenerate} disabled={thinking}>
                {thinking ? <><span className="k-typing"><i /><i /><i /></span>Thinking</> : <><Icon name="redo" />Regenerate</>}
              </button>
            </div>
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
              <span className="k-micro">Template: the creator community layout.</span>
              <div className="k-r">
                <button className="k-btn" type="button" onClick={onClose}>Cancel</button>
                <button className="k-btn primary" type="button" onClick={create} disabled={!todo.length}>
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
