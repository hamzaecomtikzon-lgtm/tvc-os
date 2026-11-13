import { useState } from "react";
import { useApp } from "../context/app.js";
import { useCruva } from "../hooks/useCruva.js";
import { useCreators } from "../hooks/useCommunity.js";
import { fmtDate, int } from "../lib/format.js";
import { DateRange, Empty, PageHead, Skel } from "../components/ui.jsx";

export default function Content() {
  const { shop, range, money, request, toast, openCreator, autos, setView, canEdit, crmName } = useApp();
  const { data, loading, error } = useCruva("searchVideos", { shop_id: shop?.id, date_from: range.from, date_to: range.to, sort_by: "gmv", page_size: 25 }, !!shop);
  const { rows } = useCreators();
  const [busy, setBusy] = useState("");
  const inDiscord = new Set(rows.filter((r) => r.member).map((r) => r.handle));

  const use = async (v) => {
    if (!autos.winning_content.channel) return toast("Pick a channel for Winning angle of the week in Automations first.");
    setBusy(v.video_id);
    const ok = await request("draft", { automation: "winning_content", videoId: v.video_id, source: "manual" });
    setBusy("");
    toast(ok ? "Draft is being built. It’s waiting in Approvals." : "Couldn’t start the draft. The server isn’t answering.");
    if (ok) setView({ ap: "pending" });
  };

  return (
    <>
      <PageHead title="Content" desc={`Top videos with your products in this range, from ${crmName} (sample data).`}><DateRange /></PageHead>
      {loading ? <div className="tile"><Skel n={8} /></div> : error ? <div className="tile"><Empty title="Couldn’t load videos">{error.message}</Empty></div> : (
        <div className="tblwrap"><table className="tbl">
          <thead><tr><th>#</th><th>Video</th><th>Creator</th><th>Posted</th><th className="r">Views</th><th className="r">GMV</th><th /></tr></thead>
          <tbody>
            {data.videos.map((v, i) => (
              <tr key={v.video_id} onClick={() => openCreator("c:" + v.handle)}>
                <td className="muted mono">{i + 1}</td>
                <td><b style={{ color: "var(--color-heading)", fontWeight: 500 }}>“{v.hooks?.[0]?.hook || v.title}”</b><div className="muted" style={{ fontSize: "var(--text-micro)" }}>{v.title.split(" · ")[0]} · <a href={v.video_link} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>Watch on TikTok</a></div></td>
                <td>@{v.handle} {inDiscord.has(v.handle) && <span className="pill good">In Discord</span>}</td>
                <td className="muted">{fmtDate(v.post_time)}</td>
                <td className="r num">{int(v.views)}</td><td className="r num">{money(v.gmv, true)}</td>
                <td><button className="btn sm ghost" type="button" disabled={!canEdit || !!busy} onClick={(e) => { e.stopPropagation(); use(v); }}>{busy === v.video_id ? "Building…" : "Use as winning angle"}</button></td>
              </tr>
            ))}
            {!data.videos.length && <tr><td colSpan={7}><Empty title="No videos in this range">Pick a longer range.</Empty></td></tr>}
          </tbody>
        </table></div>
      )}
    </>
  );
}
