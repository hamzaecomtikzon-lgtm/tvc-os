import { Fragment, useState } from "react";
import { useApp } from "../context/app.js";
import { useCruva } from "../hooks/useCruva.js";
import { int, rangeLabel } from "../lib/format.js";
import { Empty, Err, Hero, Skel } from "../components/ui.jsx";

const PAGE = 25;
const COLS = [["gmv", "GMV"], ["units_sold", "Units"], ["views", "Views"], ["ads_gmv", "Ads GMV"]];

export default function Content() {
  const { shop, range, money } = useApp();
  const [sort, setSort] = useState("gmv");
  const [page, setPage] = useState(1);
  const [handle, setHandle] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);

  // Reset to page 1 whenever the query inputs change.
  const qkey = `${shop.id}|${range.from}|${range.to}`;
  const [lastKey, setLastKey] = useState(qkey);
  if (lastKey !== qkey) {
    setLastKey(qkey);
    setPage(1);
  }

  const input = { shop_id: shop.id, date_from: range.from, date_to: range.to, sort_by: sort, sort_direction: "desc", page_size: PAGE, page_number: page };
  if (handle) input.handle = handle;
  const res = useCruva("searchVideos", input);
  const vids = res.data?.videos || [];

  const submit = (e) => {
    e.preventDefault();
    setHandle(q.trim().replace(/^@/, ""));
    setPage(1);
  };
  const sortBy = (k) => { setSort(k); setPage(1); };

  return (
    <>
      <Hero eyebrow={rangeLabel(range.from, range.to)} title="Content" lede="Every affiliate video with sales in the range. Click a row for its summary and hooks." />
      <section className="card">
        <form className="toolbar" onSubmit={submit}>
          <label htmlFor="vh" className="sr">Creator handle</label>
          <input type="search" id="vh" placeholder="Filter by creator handle" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn sm">Search</button>
          {handle && <button className="btn sm ghost" type="button" onClick={() => { setHandle(""); setQ(""); setPage(1); }}>Clear @{handle}</button>}
        </form>

        <div className="tablebox">
          {res.error ? <Err error={res.error} /> : res.loading ? <Skel n={8} /> : !vids.length ? (
            <Empty title="No videos">Try a wider range{handle ? " or another handle" : ""}.</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Creator</th><th>Video</th>
                  {COLS.map(([k, l]) => (
                    <th key={k} className="r">
                      <button onClick={() => sortBy(k)} aria-sort={sort === k ? "descending" : undefined}>{l}{sort === k ? " ↓" : ""}</button>
                    </th>
                  ))}
                  <th className="r">Ad ROI</th>
                </tr>
              </thead>
              <tbody>
                {vids.map((x) => {
                  const toggle = () => setOpen(open === x.video_id ? null : x.video_id);
                  return (
                    <Fragment key={x.video_id}>
                      <tr className="clk" tabIndex={0} aria-expanded={open === x.video_id} onClick={toggle} onKeyDown={(e) => e.key === "Enter" && toggle()}>
                        <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>@{x.handle}</td>
                        <td style={{ maxWidth: 380 }}>
                          <span className="trunc">{x.title || x.content_overview || "Untitled"}</span>
                          <span className="muted">Posted {x.post_time}</span>
                        </td>
                        <td className="r num">{money(x.gmv)}</td>
                        <td className="r">{int(x.units_sold)}</td>
                        <td className="r">{int(x.views)}</td>
                        <td className="r">{x.ads_gmv == null ? <span className="muted">unknown</span> : money(x.ads_gmv)}</td>
                        <td className="r">
                          <span className={"pill " + (x.roi == null ? "line" : x.roi >= 1 ? "good" : "bad")}>{x.roi == null ? "—" : x.roi.toFixed(2) + "x"}</span>
                        </td>
                      </tr>
                      {open === x.video_id && (
                        <tr className="detail">
                          <td colSpan={7}>
                            <div className="grid">
                              <div>
                                <h3>Summary</h3>
                                <p style={{ margin: "6px 0 0" }}>{x.content_overview || "No summary."}</p>
                                {x.video_link && <p><a href={x.video_link} target="_blank" rel="noopener noreferrer">Watch on TikTok ↗</a></p>}
                              </div>
                              <div>
                                <h3>Hooks</h3>
                                {x.hooks?.length ? x.hooks.map((h, i) => (
                                  <div key={i} className="hook">“{h.hook}”<div className="muted" style={{ marginTop: 4 }}>{h.explanation} · {h.score}/10</div></div>
                                )) : <p className="muted">No hooks found.</p>}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="pager">
          <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
          <span className="muted">Page {page}</span>
          <button className="btn sm" disabled={!res.data?.more} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      </section>
    </>
  );
}
