/*
 * The KREO creator database on the KREO bot page (platform admins only):
 * send "Join KREO" invites to members of a server, and see who joined, with their TikTok and numbers.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../context/app.js";
import { api } from "../services/api.js";
import { Empty, Ico, Skel } from "./ui.jsx";
import { LEVELS, LevelPill } from "../lib/levels.jsx";

const usd = (n) => (n == null ? "–" : "$" + (n >= 10_000 ? Math.round(n).toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 2 })));
const short = (n) => (n == null ? "–" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n));
const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "–");
const STATUS = { joined: ["good", "Joined"], invited: ["line", "Invited"], left: ["rose", "Left"] };

export function InviteCreators({ guilds, onSent, membersIntent }) {
  const { toast } = useApp();
  const [guildId, setGuildId] = useState(guilds[0]?.id || "");
  const [list, setList] = useState(undefined); // undefined loading · null no intent · [] members
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState([]);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);

  useEffect(() => {
    let on = true;
    setList(undefined);
    setPicked([]);
    if (!guildId) return undefined;
    api("GET", `/kreo/guilds/${guildId}/members`).then((r) => on && setList(r.members)).catch((e) => { if (on) { setList(null); toast(e.message); } });
    return () => { on = false; };
  }, [guildId, toast]);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (list || []).filter((m) => !f || m.name.toLowerCase().includes(f) || m.user.toLowerCase().includes(f)).slice(0, 100);
  }, [list, filter]);
  const ids = list === null ? [...new Set(typed.split(/[\s,]+/).filter((x) => /^\d{17,20}$/.test(x)))] : picked;
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 25 ? p : [...p, id]));

  const send = async () => {
    setBusy(true);
    setOut(null);
    try {
      const r = await api("POST", "/kreo/invite", { guildId, userIds: ids, appUrl: location.origin });
      setOut(r);
      setPicked([]);
      setTyped("");
      onSent?.();
    } catch (e) {
      setOut({ error: e.message });
    } finally {
      setBusy(false);
    }
  };

  if (!guilds.length) return null;
  return (
    <section className="card2">
      <div className="h"><h3>Invite creators to KREO</h3><p>KREO DMs each person a <b>Join KREO</b> button. It opens a short page in this app where they link their TikTok, pick a niche and agree that brands can find them. They don’t need an account. People can also message KREO “join” to get the button.</p></div>
      <AutoInvite membersIntent={membersIntent} />
      <div className="frow">
        <label className="field">Server
          <select className="input" value={guildId} onChange={(e) => setGuildId(e.target.value)}>{guilds.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        </label>
        {list === null ? (
          <label className="field">Discord user ids
            <input className="input" inputMode="numeric" placeholder="One or more ids, separated by spaces or commas" value={typed} onChange={(e) => setTyped(e.target.value)} />
            <small>KREO can’t list members until Server Members Intent is on. In Discord: Developer Mode → right-click a member → Copy User ID.</small>
          </label>
        ) : (
          <label className="field">Members
            <input className="input" placeholder={list === undefined ? "Loading members…" : `Search ${list.length} members`} value={filter} disabled={list === undefined} onChange={(e) => setFilter(e.target.value)} />
          </label>
        )}
      </div>
      {Array.isArray(list) && (
        <div className="kb-people" role="listbox" aria-multiselectable="true" aria-label="Members to invite">
          {shown.map((m) => (
            <button key={m.id} type="button" role="option" aria-selected={picked.includes(m.id)} className={picked.includes(m.id) ? "on" : ""} onClick={() => toggle(m.id)}>
              <span className="kb-pa">{m.avatar ? <img src={m.avatar} alt="" /> : m.name.slice(0, 1).toUpperCase()}</span>
              <span><b>{m.name}</b><small>@{m.user}</small></span>
            </button>
          ))}
          {!shown.length && <span className="muted" style={{ padding: 8 }}>{list.length ? "No one matches." : "No members to show."}</span>}
        </div>
      )}
      <div className="kb-row">
        <button className="btn primary" type="button" disabled={busy || !ids.length} onClick={send}><Ico name="send" />{busy ? "Sending…" : ids.length ? `Send invite to ${ids.length}` : "Send invite"}</button>
        {Array.isArray(list) && picked.length > 0 && <button className="btn ghost sm" type="button" onClick={() => setPicked([])}>Clear</button>}
        {out?.error && <span className="kb-result bad" role="status"><Ico name="x" />{out.error}</span>}
        {out?.summary && <span className={"kb-result " + (out.results.some((r) => r.ok) ? "ok" : "bad")} role="status"><Ico name={out.results.some((r) => r.ok) ? "check" : "x"} />{out.summary}</span>}
      </div>
      {out?.results?.some((r) => !r.ok) && (
        <ul className="kcr-fails">{out.results.filter((r) => !r.ok).map((r) => <li key={r.userId}><b>{r.name || r.userId}</b>: {r.result}</li>)}</ul>
      )}
    </section>
  );
}

/** On/off for KREO inviting people who join a server it's in (new members only). */
export function AutoInvite({ membersIntent }) {
  const { toast } = useApp();
  const [s, setS] = useState(null);
  useEffect(() => { api("GET", "/kreo/settings").then(setS).catch((e) => toast(e.message)); }, [toast]);
  const set = async (autoInvite) => {
    try { setS(await api("PUT", "/kreo/settings", { autoInvite })); } catch (e) { toast(e.message); }
  };
  if (!s) return null;
  return (
    <div className="kcr-auto">
      <label className="cr-check"><input type="checkbox" checked={s.autoInvite} onChange={(e) => set(e.target.checked)} /><b>Invite new members automatically</b></label>
      <small className="muted">
        When someone joins a server KREO is in, KREO DMs them the Join KREO button. Only people who join from now on, never everyone already there, and never anyone who was already invited.
        {!membersIntent && <> <b>Needs Server Members Intent</b> switched on for the KREO app in the Discord Developer Portal (Bot tab), then press Restart above.</>}
      </small>
    </div>
  );
}

export function CreatorDatabase({ reloadKey }) {
  const { toast } = useApp();
  const [data, setData] = useState(null);
  const [f, setF] = useState({ q: "", niche: "", level: "", show: "all" });
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const s = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
    try {
      setData(await api("GET", "/kreo/creators?" + s));
    } catch (e) {
      toast(e.message);
    }
  }, [f, toast]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load, reloadKey]);
  useEffect(() => { const t = setInterval(load, 10_000); return () => clearInterval(t); }, [load]);

  const run = async (key, fn) => {
    setBusy(key);
    try { await fn(); await load(); } catch (e) { toast(e.message); } finally { setBusy(""); }
  };
  const samples = (add) => run("samples", () => api(add ? "POST" : "DELETE", "/kreo/creators/samples"));
  const refresh = (c) => run("r" + c.id, () => api("POST", `/kreo/creators/${c.id}/refresh`));
  const remove = (c) => confirm(`Delete ${c.discordName || c.id} from the KREO database?`) && run("d" + c.id, () => api("DELETE", `/kreo/creators/${c.id}`));

  if (!data) return <section className="card2"><Skel n={3} /></section>;
  const k = data.counts;
  return (
    <section className="card2">
      <div className="h"><h3>Creator database</h3><p>Creators who joined through KREO. Their numbers come from the CRM of the brand whose server they joined from (last 30 days), and their level is TikTok's own (L0 Bronze to L7 Diamond, by 30-day GMV; hover a level for its range).</p></div>
      <div className="kb-facts kcr-facts">
        <div><span>Joined</span><b>{k.joined}</b></div>
        <div><span>Invited, not joined yet</span><b>{k.invited}</b></div>
        <div><span>Left</span><b>{k.left}</b></div>
        <div><span>Sample creators</span><b>{k.samples}</b></div>
      </div>
      <div className="kcr-filters">
        <input className="input" placeholder="Search name, @tiktok, niche, server" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} aria-label="Search creators" />
        <select className="input" value={f.niche} onChange={(e) => setF({ ...f, niche: e.target.value })} aria-label="Niche"><option value="">All niches</option>{data.niches.map((n) => <option key={n}>{n}</option>)}</select>
        <select className="input" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })} aria-label="Level"><option value="">All levels</option>{LEVELS.map((l) => <option key={l.level} value={l.level}>L{l.level} {l.badge} ({l.range})</option>)}</select>
        <select className="input" value={f.show} onChange={(e) => setF({ ...f, show: e.target.value })} aria-label="Show"><option value="all">Real + sample</option><option value="real">Real only</option><option value="sample">Sample only</option></select>
      </div>
      {!data.creators.length ? (
        <Empty title={data.total === 0 && !f.q && !f.niche && !f.level ? "No creators yet" : "No one matches"}>
          {k.joined + k.invited + k.left + k.samples === 0 ? "Invite someone above, or add sample creators to try things out." : "Try other filters."}
        </Empty>
      ) : (
        <div className="tblwrap"><table className="tbl kcr-tbl">
          <thead><tr><th>Creator</th><th>TikTok</th><th>Niche</th><th>Country</th><th>Level</th><th className="r">GMV 30d</th><th className="r">Sales</th><th>Status</th><th>From</th><th>Joined</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {data.creators.map((c) => (
              <tr key={c.id}>
                <td><div className="kcr-who"><span className="kb-pa">{c.avatar ? <img src={c.avatar} alt="" /> : (c.discordName || "?").slice(0, 1).toUpperCase()}</span><span><b>{c.discordName || c.id}</b><small>{c.sample ? "Sample, can’t be messaged" : "@" + c.discordUser}</small></span></div></td>
                <td>{c.tiktok ? <a href={`https://www.tiktok.com/@${c.tiktok}`} target="_blank" rel="noreferrer">@{c.tiktok}</a> : "–"}</td>
                <td>{c.niche || "–"}</td>
                <td>{c.country || "–"}</td>
                <td>{c.level != null ? <LevelPill level={c.level} /> : <span className="muted" title={c.metrics && !c.metrics.found ? "Not found in the CRM" : ""}>–</span>}</td>
                <td className="r num">{c.metrics?.found ? usd(c.metrics.gmv) : "–"}</td>
                <td className="r num">{c.metrics?.found ? short(c.metrics.sales) : "–"}</td>
                <td>{c.sample ? <span className="pill line">Sample</span> : <span className={"pill " + (STATUS[c.status]?.[0] || "")}>{STATUS[c.status]?.[1] || c.status}</span>}{!c.sample && c.status === "joined" && c.metrics && !c.metrics.found && <small className="kcr-note">{c.metrics.checked ? "Not in the CRM yet" : "Server not linked to a brand"}</small>}</td>
                <td>{c.sourceGuildName || "–"}</td>
                <td>{day(c.joinedAt || c.invitedAt)}</td>
                <td className="r"><span className="kcr-acts">
                  {!c.sample && c.tiktok && <button className="btn ghost sm" type="button" title="Read their numbers from the CRM again" disabled={!!busy} onClick={() => refresh(c)}><Ico name="redo" /></button>}
                  <button className="btn ghost sm" type="button" title="Delete" disabled={!!busy} onClick={() => remove(c)}><Ico name="x" /></button>
                </span></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <div className="kb-row">
        <button className="btn sm" type="button" disabled={!!busy} onClick={() => samples(true)}><Ico name="plus" />{busy === "samples" ? "Working…" : k.samples ? "Reload 50 sample creators" : "Add 50 sample creators"}</button>
        {k.samples > 0 && <button className="btn sm ghost" type="button" disabled={!!busy} onClick={() => samples(false)}>Remove all sample creators</button>}
        <small className="muted">Samples are made up, labelled “Sample”, and can never be messaged. They’re there so search has something to find while real creators join.</small>
      </div>
      {!data.appUrl && <small className="muted">The Join button links to this app’s address. It’s remembered the first time you send an invite from here; set KREO_APP_URL on the backend to fix it explicitly.</small>}
    </section>
  );
}
