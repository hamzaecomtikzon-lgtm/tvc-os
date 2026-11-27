import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../context/app.js";
import { api } from "../services/api.js";
import { db, useDb } from "../services/db.js";
import { Dialog, Empty, Ico, PageHead, Pop, Skel } from "../components/ui.jsx";
import { LEVELS, LevelPill } from "../lib/levels.jsx";

const EXAMPLES = ["L1–L2 health creators in the US", "Gold beauty creators with 10k+ followers", "L3+ fitness creators", "Supplement creators over $5k GMV"];
const NICHES = ["Health & wellness", "Beauty & skincare", "Fashion", "Fitness", "Food & drink", "Home & kitchen", "Tech & gadgets", "Pets", "Baby & kids", "Lifestyle", "Other"];
const COUNTRIES = [["US", "United States"], ["GB", "United Kingdom"], ["CA", "Canada"], ["AU", "Australia"], ["DE", "Germany"], ["FR", "France"], ["IT", "Italy"], ["ES", "Spain"], ["MX", "Mexico"], ["BR", "Brazil"], ["PH", "Philippines"], ["MY", "Malaysia"], ["ID", "Indonesia"], ["TH", "Thailand"], ["VN", "Vietnam"], ["SG", "Singapore"], ["PK", "Pakistan"], ["IN", "India"], ["AE", "United Arab Emirates"], ["SA", "Saudi Arabia"]];
const EMPTY = { levels: [], niches: [], countries: [], minFollowers: "", maxFollowers: "", minGmv: "", maxGmv: "", text: "", sort: "gmv", samples: true };
const STATUS = {
  messaged: ["", "Messaged"], invited: ["", "Introduced by KREO"], joined: ["good", "Joined your server"], replied: ["good", "Replied"], failed: ["rose", "Not delivered"],
};
const compact = (n) => (n == null ? "–" : n >= 1e6 ? +(n / 1e6).toFixed(1) + "M" : n >= 1e3 ? +(n / 1e3).toFixed(1) + "k" : String(Math.round(n)));
const usd = (n) => (n == null ? "–" : "$" + compact(n));
const ago = (iso) => {
  if (!iso) return "";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago";
};
const country = (c) => COUNTRIES.find(([x]) => x === c)?.[1] || c || "–";
const toQuery = (f) => new URLSearchParams(Object.entries({ ...f, levels: f.levels.join(","), niches: f.niches.join(","), countries: f.countries.join(","), samples: f.samples ? "1" : "0" }).filter(([, v]) => v !== "" && v != null));

/**
 * KREO AI creator search (#creator-search): brands find creators who joined KREO, save them to
 * shortlists and reach out (through their own bot, or through KREO with an invite to their server).
 */
export default function CreatorSearch() {
  const { toast, user, view, setView } = useApp();
  useDb();
  const [query, setQuery] = useState("");
  const [f, setF] = useState(EMPTY);
  const [summary, setSummary] = useState(null); // { text, source }
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("results");
  const [msgFor, setMsgFor] = useState(null);
  const [openList, setOpenList] = useState(null);
  const canMessage = user.role !== "Viewer";

  const lists = db.list("shortlists").sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  const outreach = db.list("outreach").sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

  const load = useCallback(async (filters) => {
    try {
      setData(await api("GET", "/creator-search?" + toQuery(filters)));
    } catch (e) {
      toast(e.message);
    }
  }, [toast]);
  useEffect(() => { const t = setTimeout(() => load(f), 250); return () => clearTimeout(t); }, [f, load]);

  const ask = async (q = query) => {
    if (!q.trim()) return;
    setQuery(q);
    setBusy(true);
    try {
      const r = await api("POST", "/creator-search/parse", { query: q });
      const x = r.filters;
      setF({ ...EMPTY, samples: f.samples, levels: x.levels, niches: x.niches, countries: x.countries, minFollowers: x.minFollowers || "", maxFollowers: x.maxFollowers || "", minGmv: x.minGmv || "", maxGmv: x.maxGmv || "", text: x.text || "", sort: x.sort });
      setSummary({ text: x.summary, source: r.source });
      setTab("results");
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };
  // Arriving from quick find (⌘K → "Find creators: …"): run that search once.
  useEffect(() => {
    if (!view.csq) return;
    const q = view.csq;
    setView({ csq: undefined });
    ask(q);
  }, [view.csq]); // eslint-disable-line react-hooks/exhaustive-deps
  const reset = () => { setF({ ...EMPTY, samples: f.samples }); setSummary(null); setQuery(""); };
  const toggle = (key, v) => setF({ ...f, [key]: f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v] });

  const saveTo = async (list, c) => {
    try {
      if (list === "new") {
        const name = prompt("Name the new shortlist", "Shortlist " + (lists.length + 1));
        if (!name?.trim()) return;
        const id = Date.now().toString(36);
        await db.set("shortlists/" + id, { name: name.trim().slice(0, 60), creators: [c.id], createdAt: new Date().toISOString(), by: user.name });
        toast(`Saved ${c.name} to “${name.trim()}”`);
      } else {
        const has = list.creators.includes(c.id);
        await db.set("shortlists/" + list.id, { ...db.get("shortlists/" + list.id), creators: has ? list.creators.filter((x) => x !== c.id) : [...list.creators, c.id] });
        toast(has ? `Removed ${c.name} from “${list.name}”` : `Saved ${c.name} to “${list.name}”`);
      }
    } catch (e) {
      toast(e.message);
    }
  };

  const active = f.levels.length + f.niches.length + f.countries.length + ["minFollowers", "maxFollowers", "minGmv", "maxGmv", "text"].filter((k) => f[k] !== "").length;
  const replies = outreach.filter((o) => o.status === "replied").length;

  return (
    <>
      <PageHead title="Creator search" desc="Find creators who joined KREO and agreed to work with brands. Ask in plain words, then message them from here." />
      <section className="cs-ask card2">
        <form className="cs-askrow" onSubmit={(e) => { e.preventDefault(); ask(); }}>
          <Ico name="spark" />
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. L1 or L2 health creators in the US with 10k+ followers" aria-label="Describe the creators you want" />
          <button className="btn primary" type="submit" disabled={busy || !query.trim()}>{busy ? "Searching…" : "Search"}</button>
        </form>
        <div className="cs-examples">{EXAMPLES.map((x) => <button key={x} type="button" className="chip" onClick={() => ask(x)}>{x}</button>)}</div>
        {summary && <p className="cs-summary"><Ico name="check" /><span>Showing <b>{summary.text}</b>{summary.source === "ai" ? " · understood by AI" : ""}. Adjust the filters below to refine.</span></p>}
      </section>

      <div className="cs-filters">
        <div className="filters cr-levels" role="group" aria-label="Level">
          <span className="cr-lab">Level</span>
          <button type="button" className={"chip" + (!f.levels.length ? " on" : "")} onClick={() => setF({ ...f, levels: [] })}>Any</button>
          {LEVELS.map((l) => <button key={l.level} type="button" title={`30-day GMV ${l.range}`} aria-pressed={f.levels.includes(l.level)} className={"chip" + (f.levels.includes(l.level) ? " on" : "")} onClick={() => toggle("levels", l.level)}>L{l.level} {l.badge}</button>)}
        </div>
        <div className="cs-frow">
          <label className="field">Niche
            <select className="input" value={f.niches[0] || ""} onChange={(e) => setF({ ...f, niches: e.target.value ? [e.target.value] : [] })}><option value="">Any niche</option>{NICHES.map((n) => <option key={n}>{n}</option>)}</select>
          </label>
          <label className="field">Country
            <select className="input" value={f.countries[0] || ""} onChange={(e) => setF({ ...f, countries: e.target.value ? [e.target.value] : [] })}><option value="">Anywhere</option>{COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
          </label>
          <label className="field">Followers at least<input className="input" type="number" min="0" placeholder="e.g. 10000" value={f.minFollowers} onChange={(e) => setF({ ...f, minFollowers: e.target.value })} /></label>
          <label className="field">Followers at most<input className="input" type="number" min="0" placeholder="Any" value={f.maxFollowers} onChange={(e) => setF({ ...f, maxFollowers: e.target.value })} /></label>
          <label className="field">30-day GMV at least ($)<input className="input" type="number" min="0" placeholder="e.g. 1000" value={f.minGmv} onChange={(e) => setF({ ...f, minGmv: e.target.value })} /></label>
          <label className="field">Sort by
            <select className="input" value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })}><option value="gmv">30-day GMV</option><option value="followers">Followers</option><option value="level">Level</option><option value="newest">Newest on KREO</option></select>
          </label>
        </div>
        <div className="kb-row">
          <label className="cr-check"><input type="checkbox" checked={f.samples} onChange={(e) => setF({ ...f, samples: e.target.checked })} />Include sample creators</label>
          {(active > 0 || summary) && <button type="button" className="btn ghost sm" onClick={reset}>Clear search</button>}
        </div>
      </div>

      <div className="tabs" role="tablist">
        {[["results", `Results${data ? " · " + data.total : ""}`], ["lists", `Shortlists · ${lists.length}`], ["outreach", `Outreach · ${outreach.length}${replies ? ` (${replies} replied)` : ""}`]].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === "results" && (!data ? <Skel n={4} /> : !data.creators.length ? (
        <Empty title="No creators match">Try fewer filters, or a wider level range.{active > 0 && <> <button className="btn ghost sm" type="button" onClick={reset}>Clear search</button></>}</Empty>
      ) : (
        <>
          {!data.real && <p className="muted cs-note">No real creators match yet: these are sample creators, so you can see how search works. Real creators appear as they join KREO.</p>}
          <div className="cs-grid">{data.creators.map((c) => <Card key={c.id} c={c} lists={lists} onSave={saveTo} onMessage={canMessage ? () => setMsgFor(c) : null} />)}</div>
        </>
      ))}

      {tab === "lists" && <Lists lists={lists} open={openList} setOpen={setOpenList} onMessage={canMessage ? setMsgFor : null} onSave={saveTo} />}
      {tab === "outreach" && <Outreach rows={outreach} />}

      {msgFor && <MessageDialog c={msgFor} onClose={() => setMsgFor(null)} onSent={() => load(f)} />}
    </>
  );
}

function Card({ c, lists, onSave, onMessage }) {
  const o = c.outreach;
  const saved = lists.filter((l) => l.creators.includes(c.id));
  return (
    <article className={"cs-card" + (c.sample ? " sample" : "")}>
      <div className="cs-top">
        <span className="cs-av">{c.avatar ? <img src={c.avatar} alt="" /> : (c.name || "?").slice(0, 1).toUpperCase()}</span>
        <div style={{ minWidth: 0 }}>
          <b>{c.name}</b>
          {c.tiktok && <a href={`https://www.tiktok.com/@${c.tiktok}`} target="_blank" rel="noreferrer">@{c.tiktok}</a>}
        </div>
        <LevelPill level={c.level} />
      </div>
      <div className="cs-tags">
        {c.niche && <span className="pill line">{c.niche}</span>}
        <span className="pill line">{country(c.country)}</span>
        {c.sample && <span className="pill line">Sample</span>}
        {c.inServer && <span className="pill good">In your server</span>}
        {o && <span className={"pill " + (STATUS[o.status]?.[0] || "")}>{STATUS[o.status]?.[1] || o.status}</span>}
      </div>
      <dl className="cs-stats">
        <div><dt>Followers</dt><dd>{compact(c.followers)}</dd></div>
        <div><dt>30-day GMV</dt><dd>{usd(c.gmv30)}</dd></div>
        <div><dt>Engagement</dt><dd>{c.engagement != null ? c.engagement + "%" : "–"}</dd></div>
      </dl>
      {c.categories?.filter((x) => x !== c.niche).length > 0 && <p className="cs-cats">{c.categories.filter((x) => x !== c.niche).slice(0, 3).join(" · ")}</p>}
      <div className="cs-acts">
        {onMessage && <button className="btn primary sm" type="button" disabled={c.sample} title={c.sample ? "Sample creators can’t be messaged" : ""} onClick={onMessage}><Ico name="send" />{o ? "Message again" : "Message"}</button>}
        <Pop button={(toggle) => <button className="btn sm" type="button" onClick={toggle}><Ico name="plus" />{saved.length ? `Saved (${saved.length})` : "Save"}</button>}>
          {(close) => (
            <>
              <div className="ph2"><b>Save to a shortlist</b></div>
              {lists.map((l) => <button key={l.id} className="pi" type="button" onClick={() => { close(); onSave(l, c); }}><Ico name={l.creators.includes(c.id) ? "check" : "plus"} />{l.name} <small className="muted">({l.creators.length})</small></button>)}
              <button className="pi" type="button" onClick={() => { close(); onSave("new", c); }}><Ico name="plus" />New shortlist…</button>
            </>
          )}
        </Pop>
      </div>
    </article>
  );
}

function MessageDialog({ c, onClose, onSent }) {
  const { user, guild } = useApp();
  const first = (c.name || "").split(" ")[0];
  const [text, setText] = useState(`Hi ${first}! 👋 We're ${user.brand} and we love your ${c.niche ? c.niche.toLowerCase() + " " : ""}content. We'd love to send you a free sample and work on a TikTok Shop collab together. Interested?`);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const send = async () => {
    setBusy(true);
    try {
      const r = await api("POST", `/creator-search/${c.id}/message`, { text });
      setOut(r);
      onSent?.();
    } catch (e) {
      setOut({ ok: false, result: e.message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={`Message ${c.name}`} onClose={onClose} actions={out?.ok
      ? <button className="btn primary" type="button" onClick={onClose}>Done</button>
      : <><button className="btn ghost" type="button" onClick={onClose}>Cancel</button><button className="btn primary" type="button" disabled={busy || text.trim().length < 10} onClick={send}><Ico name="send" />{busy ? "Sending…" : "Send"}</button></>}>
      <div className="cs-route">
        <Ico name={c.inServer ? "chat" : "server"} />
        <span>{c.inServer
          ? <>{c.name} is in <b>{guild?.guildName || "your server"}</b>, so this goes from <b>your bot</b>. Replies show up in Onboarding & DMs.</>
          : <>{c.name} isn’t in your server yet, so <b>KREO</b> delivers it, with a button to join {guild?.guildName ? <b>{guild.guildName}</b> : "your server"}. When they join, your bot sends it again and the chat continues there.</>}</span>
      </div>
      {!out?.ok && (
        <label className="field">Your message
          <textarea className="input" rows={6} maxLength={1500} value={text} onChange={(e) => setText(e.target.value)} />
          <small>Be specific: what you’d like them to make, and what they get (free sample, commission, a flat fee). One message every few days per creator.</small>
        </label>
      )}
      {out && <p className={"kb-result " + (out.ok ? "ok" : "bad")} role="status"><Ico name={out.ok ? "check" : "x"} />{out.result}</p>}
    </Dialog>
  );
}

function Lists({ lists, open, setOpen, onMessage, onSave }) {
  const { toast } = useApp();
  const [rows, setRows] = useState(null);
  const list = lists.find((l) => l.id === open) || null;
  const ids = useMemo(() => list?.creators || [], [list]);
  useEffect(() => {
    let on = true;
    setRows(null);
    if (!ids.length) { setRows([]); return undefined; }
    Promise.all(ids.map((id) => api("GET", "/creator-search/" + id).then((r) => r.creator).catch(() => ({ id, gone: true })))).then((x) => on && setRows(x));
    return () => { on = false; };
  }, [ids]);
  const rename = async (l) => {
    const name = prompt("Rename the shortlist", l.name);
    if (name?.trim()) await db.set("shortlists/" + l.id, { ...db.get("shortlists/" + l.id), name: name.trim().slice(0, 60) }).catch((e) => toast(e.message));
  };
  const remove = async (l) => {
    if (!confirm(`Delete the shortlist “${l.name}”? The creators stay on KREO.`)) return;
    await db.remove("shortlists/" + l.id).catch((e) => toast(e.message));
    setOpen(null);
  };
  if (!lists.length) return <Empty title="No shortlists yet">Press <b>Save</b> on a creator to start one, e.g. “Q1 health campaign”.</Empty>;
  return (
    <div className="cs-lists">
      <ul>{lists.map((l) => <li key={l.id}><button type="button" className={open === l.id ? "on" : ""} onClick={() => setOpen(l.id)}><b>{l.name}</b><span>{l.creators.length} creator{l.creators.length === 1 ? "" : "s"}{l.by ? " · by " + l.by : ""}</span></button></li>)}</ul>
      <div>
        {!list ? <span className="muted">Pick a shortlist.</span> : (
          <>
            <div className="kb-row" style={{ marginBottom: 12 }}><h3 style={{ marginRight: "auto" }}>{list.name}</h3><button className="btn sm ghost" type="button" onClick={() => rename(list)}><Ico name="edit" />Rename</button><button className="btn sm ghost" type="button" onClick={() => remove(list)}><Ico name="x" />Delete</button></div>
            {!rows ? <Skel n={3} /> : !rows.length ? <Empty title="Empty shortlist">Save creators to it from the results.</Empty> : (
              <div className="cs-grid">{rows.map((c) => c.gone
                ? <article key={c.id} className="cs-card"><b>No longer on KREO</b><span className="muted">This creator left KREO or was removed.</span><button className="btn sm ghost" type="button" onClick={() => onSave(list, { id: c.id, name: "this creator" })}>Remove from list</button></article>
                : <Card key={c.id} c={c} lists={lists} onSave={onSave} onMessage={onMessage ? () => onMessage(c) : null} />)}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Outreach({ rows }) {
  const { go } = useApp();
  const [open, setOpen] = useState(null);
  if (!rows.length) return <Empty title="No outreach yet">Message a creator from the results. Every message, join and reply is tracked here.</Empty>;
  const counts = Object.fromEntries(Object.keys(STATUS).map((k) => [k, rows.filter((r) => r.status === k).length]));
  return (
    <>
      <div className="kb-facts kcr-facts" style={{ marginBottom: 12 }}>
        <div><span>Reached out</span><b>{rows.length}</b></div>
        <div><span>Joined your server</span><b>{counts.joined + rows.filter((r) => r.status === "replied" && r.joinedServerAt).length}</b></div>
        <div><span>Replied</span><b>{counts.replied}</b></div>
        <div><span>Not delivered</span><b>{counts.failed}</b></div>
      </div>
      <div className="tblwrap"><table className="tbl" style={{ minWidth: 820 }}>
        <thead><tr><th>Creator</th><th>Status</th><th>How</th><th>Sent by</th><th>Last update</th><th>Latest reply</th></tr></thead>
        <tbody>
          {rows.map((o) => (
            <Fragment key={o.id}>
              <tr onClick={() => setOpen(open === o.id ? null : o.id)}>
                <td><div className="kcr-who"><span className="kb-pa">{o.avatar ? <img src={o.avatar} alt="" /> : (o.name || "?").slice(0, 1).toUpperCase()}</span><span><b>{o.name}</b><small>{o.tiktok ? "@" + o.tiktok : ""}</small></span></div></td>
                <td><span className={"pill " + (STATUS[o.status]?.[0] || "")}>{STATUS[o.status]?.[1] || o.status}</span></td>
                <td>{o.via === "brand" ? "Your bot" : "KREO intro"}</td>
                <td>{o.by || "–"}</td>
                <td className="muted">{ago(o.updatedAt)}</td>
                <td className="cs-reply">{o.replies?.length ? "“" + o.replies.at(-1).text + "”" : o.error ? <span className="muted">{o.error}</span> : <span className="muted">–</span>}</td>
              </tr>
              {open === o.id && (
                <tr className="cs-hist"><td colSpan={6}>
                  <b>Your message</b><p>{o.text}</p>
                  <b>Timeline</b>
                  <ul>{(o.history || []).map((h, i) => <li key={i}><span className="muted">{new Date(h.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span> {h.what}</li>)}</ul>
                  {o.replies?.length > 0 && <><b>Replies</b><ul>{o.replies.map((r, i) => <li key={i}><span className="muted">{ago(r.at)} · to {r.to === "kreo" ? "KREO" : "your bot"}</span> {r.text}</li>)}</ul></>}
                  {(o.via === "brand" || o.joinedServerAt || o.replies?.some((r) => r.to === "brand")) && <button className="btn sm" type="button" onClick={() => go("onboarding", { ob: "inbox", dm: o.id })}><Ico name="chat" />Open the conversation</button>}
                </td></tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table></div>
    </>
  );
}
