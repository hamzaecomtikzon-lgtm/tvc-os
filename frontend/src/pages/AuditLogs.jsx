import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../context/app.js";
import { api } from "../services/api.js";
import { downloadCsv } from "../lib/format.js";
import { Empty, Ico, PageHead, Pop, Skel } from "../components/ui.jsx";

/** Account type column: a team member's role, or what kind of non-person did it. */
const TYPE = { bot: "Bot", schedule: "Schedule", discord: "Discord moderator", system: "System" };
const PLATFORM_CLASS = { "Web app": "web", Discord: "discord", Schedule: "schedule", Bot: "bot", System: "system" };
const RANGES = [["all", "All time"], ["1", "Last 24 hours"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"]];
// Rows whose Action is shown in red: failures and risky changes.
const LOUD = /^(workspace\.reset|crm\.(disconnect|key_change)|team\.(remove|role)|draft\.(post_failed|build_failed)|role\.give_failed|onboarding\.welcome_failed|channels\.create_failed)$/;

const stamp = (iso) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
const accountOf = (a) => a.email || (a.type === "discord" ? `${a.name} (Discord)` : a.name);
const typeOf = (a) => (a.type === "user" ? a.role || "User" : TYPE[a.type] || a.type);
const rangeLabel = (r) => (r.key === "custom" ? `${r.from || "…"} – ${r.to || "…"}` : RANGES.find(([k]) => k === r.key)?.[1] || "All time");

/** Owners and admins: every action anyone (or the bot) took in this workspace, as a table like a CRM's audit log. */
export default function AuditLogs() {
  const { isAdmin, toast } = useApp();
  const [f, setF] = useState({ actor: "", action: "", shop: "", platform: "", q: "" });
  const [range, setRange] = useState({ key: "all", from: "", to: "" });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState({ entries: null, next: null });
  const [facets, setFacets] = useState({ actors: [], actions: [], shops: [], platforms: [] });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);
  const seq = useRef(0);

  const params = useCallback((extra = {}) => {
    const s = new URLSearchParams();
    for (const k of ["actor", "action", "shop", "platform", "q"]) if (f[k]) s.set(k, f[k]);
    if (range.key === "custom") {
      if (range.from) s.set("from", new Date(range.from + "T00:00:00").toISOString());
      if (range.to) s.set("to", new Date(new Date(range.to + "T00:00:00").getTime() + 864e5).toISOString());
    } else if (range.key !== "all") s.set("from", new Date(Date.now() - Number(range.key) * 864e5).toISOString());
    for (const [k, v] of Object.entries(extra)) s.set(k, v);
    return s.toString();
  }, [f, range]);

  const load = useCallback(async (more) => {
    const n = ++seq.current;
    setBusy(true);
    try {
      const r = await api("GET", "/audit?" + params(more ? { before: page.next, limit: 50 } : { limit: 50 }));
      if (n !== seq.current) return; // a newer filter change already asked again
      setError(null);
      setPage((p) => ({ entries: more ? [...(p.entries || []), ...r.entries] : r.entries, next: r.next }));
      if (r.actors) setFacets({ actors: r.actors, actions: r.actions, shops: r.shops, platforms: r.platforms });
    } catch (e) {
      if (n === seq.current) setError(e);
    } finally {
      if (n === seq.current) setBusy(false);
    }
  }, [params, page.next]);

  useEffect(() => { if (isAdmin) load(false); }, [f, range, isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(() => setF((x) => (x.q === search.trim() ? x : { ...x, q: search.trim() })), 350); return () => clearTimeout(t); }, [search]);
  // Keep the first page fresh while the page is open (paused while a row is expanded).
  useEffect(() => {
    if (!isAdmin) return undefined;
    const t = setInterval(() => { if (document.visibilityState === "visible" && open == null) load(false); }, 30_000);
    return () => clearInterval(t);
  }, [isAdmin, load, open]);

  const set = (patch) => { setOpen(null); setF((x) => ({ ...x, ...patch })); };
  const exportCsv = async () => {
    try {
      const r = await api("GET", "/audit?" + params({ limit: 500 }));
      downloadCsv(`audit-logs-${new Date().toISOString().slice(0, 10)}.csv`, [
        ["Time", "Account", "Account type", "Shop", "Platform", "Action", "Target", "Details"],
        ...r.entries.map((e) => [stamp(e.at), accountOf(e.actor), typeOf(e.actor), e.shop?.name || "", e.platform, e.actionLabel, e.target || "", e.summary]),
      ]);
      if (r.next) toast("Exported the latest 500 entries. Narrow the filters or dates to export older ones.");
    } catch (e) {
      toast(e.message);
    }
  };

  if (!isAdmin) {
    return (
      <>
        <PageHead title="Audit logs" />
        <div className="tile"><Empty title="Only owners and admins can see the audit logs">Ask the workspace owner if you need to check who changed something.</Empty></div>
      </>
    );
  }

  const entries = page.entries || [];
  const filtered = f.actor || f.action || f.shop || f.platform || f.q || range.key !== "all";
  const sel = (key, label, options) => (
    <select className="input" aria-label={label} value={f[key]} onChange={(e) => set({ [key]: e.target.value })}>
      <option value="">{label}</option>
      {options}
    </select>
  );

  return (
    <>
      <PageHead title="Audit logs" desc="Who did what, and when: your team in the app or in Discord, the schedule, and the bot. Kept for a year, even if the workspace is reset.">
        <Pop className="pop al-range" button={(toggle) => <button className="btn" type="button" onClick={toggle}><Ico name="calendar" />{rangeLabel(range)}</button>}>
          {(close) => (
            <>
              {RANGES.map(([k, l]) => <button key={k} type="button" className={"pi" + (range.key === k ? " on" : "")} onClick={() => { setOpen(null); setRange({ key: k, from: "", to: "" }); close(); }}>{l}</button>)}
              <div className="al-custom">
                <span>Custom range</span>
                <input className="input" type="date" aria-label="From" value={range.from} max={range.to || undefined} onChange={(e) => setRange((r) => ({ ...r, key: "custom", from: e.target.value }))} />
                <input className="input" type="date" aria-label="To" value={range.to} min={range.from || undefined} onChange={(e) => setRange((r) => ({ ...r, key: "custom", to: e.target.value }))} />
              </div>
            </>
          )}
        </Pop>
        <button className="btn" type="button" disabled={!entries.length} onClick={exportCsv}><Ico name="download" />Export CSV</button>
      </PageHead>

      <div className="al-filters">
        <label className="al-search"><Ico name="search" /><input className="input" type="search" placeholder="Search actions, targets…" aria-label="Search actions and targets" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        {sel("actor", "All users", facets.actors.map((a) => <option key={a.type + ":" + a.name} value={a.type + ":" + a.name}>{a.email || a.name}{a.type === "user" ? "" : ` (${TYPE[a.type] || a.type})`}</option>))}
        {sel("action", "All actions", facets.actions.map((a) => <option key={a.code} value={a.code}>{a.label}</option>))}
        {sel("shop", "All shops", facets.shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>))}
        {sel("platform", "All platforms", facets.platforms.map((p) => <option key={p} value={p}>{p}</option>))}
      </div>

      {error ? <div className="tile"><Empty title="Couldn’t load the audit logs">{error.message}</Empty></div>
        : page.entries === null ? <div className="tile"><Skel n={8} /></div>
        : (
          <div className="tblwrap">
            <table className="tbl al-tbl">
              <thead><tr><th>Time</th><th>Account</th><th>Account type</th><th>Shop</th><th>Platform</th><th>Action</th><th>Target</th></tr></thead>
              <tbody>
                {entries.map((e) => {
                  const isOpen = open === e.id;
                  const d = e.details || {};
                  return (
                    <Fragment key={e.id}>
                      <tr className={isOpen ? "open" : ""} onClick={() => setOpen(isOpen ? null : e.id)} aria-expanded={isOpen}>
                        <td className="al-time">{stamp(e.at)}</td>
                        <td className="al-acct" title={e.actor.email ? e.actor.name : undefined}>{accountOf(e.actor)}</td>
                        <td><span className="al-type">{typeOf(e.actor)}</span></td>
                        <td className="al-shop">{e.shop ? <>{e.shop.region && <small>{e.shop.region}</small>}{e.shop.name}</> : <span className="muted">—</span>}</td>
                        <td><span className={"al-plat " + (PLATFORM_CLASS[e.platform] || "system")}>{e.platform}</span></td>
                        <td className={"al-action" + (LOUD.test(e.action) ? " loud" : "")}>{e.actionLabel}</td>
                        <td className="al-target" title={e.target || ""}>{e.target || <span className="muted">—</span>}</td>
                      </tr>
                      {isOpen && (
                        <tr className="al-detail"><td colSpan={7}>
                          <div className="al-detail-in">
                            <b>{e.summary}</b>
                            {d.fields?.length > 1 && <ul>{d.fields.map((x) => <li key={x}>{x}</li>)}</ul>}
                            {d.text && <blockquote>{d.text}</blockquote>}
                            {d.summary && <pre>{d.summary}</pre>}
                            <div className="muted">
                              {e.actor.name}{e.actor.email ? ` · ${e.actor.email}` : ""} · {new Date(e.at).toLocaleString()}
                              {d.messageUrl && <> · <a href={d.messageUrl} target="_blank" rel="noopener noreferrer" onClick={(ev) => ev.stopPropagation()}>Open the post in Discord</a></>}
                            </div>
                          </div>
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
                {!entries.length && (
                  <tr className="al-empty"><td colSpan={7}>
                    <Empty title={filtered ? "Nothing matches these filters" : "Nothing recorded yet"}>{filtered ? "Try another user, action, shop, platform or date range." : "Actions show up here as soon as anyone approves a post, changes a setting or the bot does something."}</Empty>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      {page.next && <div className="al-more"><button className="btn sm" type="button" disabled={busy} onClick={() => load(true)}>{busy ? "Loading…" : "Load older entries"}</button></div>}
    </>
  );
}
