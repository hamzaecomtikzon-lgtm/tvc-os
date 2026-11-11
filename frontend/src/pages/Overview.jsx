import { useApp } from "../context/app.js";
import { useCruva } from "../hooks/useCruva.js";
import { KPI } from "../lib/constants.js";
import { int, rangeLabel } from "../lib/format.js";
import { Chg, Empty, Err, Hero, Kpi, Skel } from "../components/ui.jsx";
import LineChart from "../components/LineChart.jsx";

const KEYS = KPI.map((k) => k[0]);

export default function Overview() {
  const { shop, range, money } = useApp();
  const base = { shop_id: shop.id, date_from: range.from, date_to: range.to };
  const stats = useCruva("getShopStats", { ...base, stats: KEYS });
  const chart = useCruva("getShopStats", { ...base, stats: ["total_gmv", "affiliate_gmv"], include_charts: true });
  const vids = useCruva("searchVideos", { ...base, sort_by: "gmv", sort_direction: "desc", page_size: 50 });

  return (
    <>
      <Hero eyebrow={rangeLabel(range.from, range.to)} title={shop.name} lede="Last 2 days may be incomplete." />

      <section className="kpis" aria-label="Key numbers">
        {stats.error ? <div className="kpi span"><Err error={stats.error} /></div> : KPI.map(([k, l, f, d]) => {
          const s = stats.data?.[k];
          return (
            <Kpi key={k} label={l} tip={d} loading={stats.loading}
              value={s ? (f === "money" ? money(s.v, true) : int(s.v)) : "—"}
              chg={s ? <Chg dir={s.dir} pct={s.pct} /> : null} />
          );
        })}
      </section>

      <div className="grid">
        <section className="card span">
          <div className="head">
            <h2>GMV by day</h2>
            <div className="legend"><span><i style={{ background: "var(--s1)" }} />Total GMV</span><span><i style={{ background: "var(--s2)" }} />Affiliate GMV</span></div>
          </div>
          {chart.error ? <Err error={chart.error} /> : chart.loading ? <Skel n={6} /> : (
            <LineChart
              series={[
                { name: "Total", color: "var(--s1)", pts: chart.data.total_gmv?.series || [], area: true },
                { name: "Affiliate", color: "var(--s2)", pts: chart.data.affiliate_gmv?.series || [] },
              ]}
              axisFmt={(x) => money(x, true)} tipFmt={(x) => money(x)} />
          )}
        </section>

        <section className="card">
          <div className="head"><h2>Affiliate GMV: ads vs organic</h2></div>
          {stats.error ? <Err error={stats.error} /> : stats.loading ? <Skel n={3} /> : <AdsSplit stats={stats.data} money={money} />}
        </section>

        <section className="card">
          <div className="head"><h2>Top creators</h2><span className="muted">From the top 50 videos in range</span></div>
          {vids.error ? <Err error={vids.error} /> : vids.loading ? <Skel n={5} /> : <TopCreators videos={vids.data.videos} money={money} />}
        </section>

        <section className="card span">
          <div className="head"><h2>Top videos</h2><a href="#content" className="muted">All content →</a></div>
          {vids.error ? <Err error={vids.error} /> : vids.loading ? <Skel n={5} /> : <TopVideos videos={vids.data.videos} money={money} />}
        </section>
      </div>
    </>
  );
}

function AdsSplit({ stats, money }) {
  const a = stats.ads_gmv?.v || 0;
  const o = stats.organic_gmv?.v || 0;
  const tot = a + o;
  if (tot <= 0) return <Empty>No affiliate GMV in this range.</Empty>;
  const pa = Math.round((a / tot) * 100), po = Math.round((o / tot) * 100);
  return (
    <>
      <div className="split" role="img" aria-label={`Ads ${pa}%, organic ${po}%`}>
        <div style={{ flex: a, background: "var(--s2)" }} />
        <div style={{ flex: o, background: "var(--s1)" }} />
      </div>
      <div className="rows" style={{ marginTop: 6 }}>
        <div><i className="swatch" style={{ background: "var(--s2)" }} /><span className="grow">Ads (GMV Max)</span><span className="num">{money(a)}</span><span className="pill">{pa}%</span></div>
        <div><i className="swatch" style={{ background: "var(--s1)" }} /><span className="grow">Organic</span><span className="num">{money(o)}</span><span className="pill">{po}%</span></div>
      </div>
    </>
  );
}

function TopCreators({ videos, money }) {
  const agg = {};
  videos.forEach((x) => {
    const a = agg[x.handle] || (agg[x.handle] = { h: x.handle, gmv: 0, vids: 0, ads: 0 });
    a.gmv += x.gmv || 0;
    a.vids++;
    if ((x.ads_gmv || 0) > 0) a.ads++;
  });
  const top = Object.values(agg).sort((a, b) => b.gmv - a.gmv).slice(0, 5);
  if (!top.length) return <Empty>No creator sales in this range.</Empty>;
  return (
    <div className="rows">
      {top.map((c, i) => (
        <div key={c.h}>
          <span className={"rank" + (i ? "" : " first")}>{String(i + 1).padStart(2, "0")}</span>
          <span className="grow">
            <span className="trunc" style={{ fontWeight: 600 }}>@{c.h}</span>
            <span className="muted">{c.vids} video{c.vids > 1 ? "s" : ""} · {c.ads} with ad sales</span>
          </span>
          <span className="num">{money(c.gmv)}</span>
        </div>
      ))}
    </div>
  );
}

function TopVideos({ videos, money }) {
  if (!videos.length) return <Empty>No videos with sales in this range.</Empty>;
  return (
    <div className="rows">
      {videos.slice(0, 5).map((x, i) => (
        <div key={x.video_id}>
          <span className={"rank" + (i ? "" : " first")}>{String(i + 1).padStart(2, "0")}</span>
          <span className="grow">
            <span className="trunc" style={{ fontWeight: 600 }}>@{x.handle}</span>
            <span className="trunc muted">{x.content_overview || x.title}</span>
          </span>
          <span className="muted" style={{ whiteSpace: "nowrap" }}>{int(x.views)} views</span>
          <span className="num">{money(x.gmv)}</span>
          {x.video_link && <a href={x.video_link} target="_blank" rel="noopener noreferrer" className="muted">Watch ↗</a>}
        </div>
      ))}
    </div>
  );
}
