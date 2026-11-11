import { useMemo, useState } from "react";
import { useApp } from "../context/app.js";
import { db, useDb } from "../services/db.js";
import { AI_AVAILABLE, suggestOnboardingQuestions } from "../services/ai.js";
import { fmtDate } from "../lib/format.js";
import { DiscordPreview, Empty, Hero } from "../components/ui.jsx";

const MAX_Q = 6;

export default function Onboarding() {
  const { guild, gid, ob, cfg, shop, saveOb, toast } = useApp();
  const v = useDb();
  const [qs, setQs] = useState(() => [...ob.questions]);
  const [welcome, setWelcome] = useState(ob.welcome);
  const [sugg, setSugg] = useState(null);
  const [thinking, setThinking] = useState(false);
  const responses = useMemo(() => db.list("onboarding_responses", (r) => r.guild === gid), [v, gid]); // eslint-disable-line react-hooks/exhaustive-deps

  const brand = shop?.name || "brand";
  const setQ = (i, val) => setQs(qs.map((q, j) => (j === i ? val : q)));
  const moveUp = (i) => { const n = [...qs]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setQs(n); };
  const del = (i) => setQs(qs.filter((_, j) => j !== i));
  const add = () => {
    setQs([...qs, ""]);
    setTimeout(() => document.getElementById("q" + qs.length)?.focus(), 0);
  };
  const save = async () => {
    const clean = qs.map((q) => q.trim()).filter(Boolean);
    if (await saveOb({ questions: clean, welcome })) {
      setQs(clean);
      toast("Onboarding saved");
    }
  };
  const suggest = async () => {
    setThinking(true);
    try {
      setSugg((await suggestOnboardingQuestions(brand)).slice(0, MAX_Q));
    } catch {
      toast("Couldn’t get suggestions. Try again.");
    } finally {
      setThinking(false);
    }
  };

  const cols = ob.questions;
  return (
    <>
      <Hero eyebrow={guild ? guild.guildName : "Discord"} title="Onboarding" lede="Questions the bot asks new members by DM." />
      <div className="grid">
        <section className="card">
          <div className="head"><h2>Welcome and questions</h2><span className="muted">{qs.length} of {MAX_Q}</span></div>
          <label className="field" style={{ marginBottom: 12 }}>
            <span>Welcome line</span>
            <input type="text" value={welcome} onChange={(e) => setWelcome(e.target.value)} />
            <small>{"{name}"} and {"{brand}"} are filled in.</small>
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {qs.map((q, i) => (
              <div key={i} className="q">
                <span className="rank">{i + 1}</span>
                <label className="sr" htmlFor={"q" + i}>Question {i + 1}</label>
                <input type="text" id={"q" + i} value={q} onChange={(e) => setQ(i, e.target.value)} placeholder="Type a question…" />
                <button className="icon" onClick={() => moveUp(i)} aria-label="Move up" disabled={!i}>↑</button>
                <button className="icon" onClick={() => del(i)} aria-label="Remove">✕</button>
              </div>
            ))}
          </div>
          <div className="row-actions" style={{ marginTop: 14 }}>
            <button className="btn" onClick={add} disabled={qs.length >= MAX_Q}>Add Question</button>
            {AI_AVAILABLE && <button className="btn" onClick={suggest} disabled={thinking}>{thinking ? "Thinking…" : "Suggest With AI"}</button>}
            <button className="btn primary" onClick={save}>Save</button>
          </div>
          {sugg && sugg.length > 0 && (
            <div className="callout" style={{ marginTop: 14, flexDirection: "column", gap: 6 }}>
              <b>Suggestions</b>
              {sugg.map((q, i) => <span key={i}>{i + 1}. {q}</span>)}
              <span className="row-actions" style={{ marginTop: 6 }}>
                <button className="btn sm" onClick={() => { setQs(sugg); setSugg(null); toast("Press Save to keep them"); }}>Use These</button>
                <button className="btn sm ghost" onClick={() => setSugg(null)}>Dismiss</button>
              </span>
            </div>
          )}
        </section>

        <section className="card">
          <div className="head"><h2>Preview</h2><span className="muted">How the DM reads</span></div>
          <DiscordPreview plain botName={cfg.botName}
            messages={[{ text: welcome.replace("{name}", "there").replace("{brand}", brand) }, ...qs.filter((q) => q.trim()).map((text) => ({ text }))]} />
        </section>
      </div>

      <section className="card">
        <div className="head"><h2>Creator responses</h2><span className="muted">{responses.length} new members</span></div>
        {!responses.length ? <Empty title="No responses yet">Answers appear here as new members reply to the bot.</Empty> : (
          <div className="tablebox">
            <table>
              <thead>
                <tr>
                  <th>Discord</th><th>Joined</th><th>Linked</th>
                  {cols.map((q) => <th key={q} title={q}>{q.length > 26 ? q.slice(0, 26) + "…" : q}</th>)}
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {responses.map((r) => (
                  <tr key={r.id}>
                    <td><b>{r.discord}</b></td>
                    <td>{fmtDate(r.joined || "")}</td>
                    <td>{r.tiktok ? <span className="pill good">@{r.tiktok}</span> : <span className="pill line">Not yet</span>}</td>
                    {cols.map((q) => <td key={q}>{(r.answers || {})[q] || "—"}</td>)}
                    <td><span className={"pill" + (r.status === "Completed" ? " good" : "")}>{r.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
