import { useEffect, useRef, useState } from "react";
import { useApp } from "../context/app.js";
import { MENTIONS, WEEKDAYS, daysTimeText } from "../lib/constants.js";
import { baseName } from "../lib/setup.js";
import { ChanSelect, Dc, Dialog, Ico, PageHead, Sw } from "../components/ui.jsx";
import { DayChips } from "./Automations.jsx";

const UNTITLED = "Untitled automation";
const HELLO = "Hi! Tell me what you want this automation to do, in plain words. For example: “Every Friday, remind creators who haven’t requested a sample yet.” I’ll draft it and show you exactly how it will look in Discord.";
const SUGGESTIONS = ["Every Friday, remind creators who haven’t requested a sample", "Shout out creators who posted 3 videos this week", "DM creators who haven’t posted in 14 days", "Post a product tip from our brief every Wednesday"];
const DAY_WORDS = { monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun" };

const fresh = (channel) => ({ name: UNTITLED, what: "", days: [], time: "", channel, mention: "@here", approval: true, text: "Describe what you want and I’ll draft it here." });

/**
 * Turn a chat message into changes to the automation. This is a rule-based
 * helper, not a language model: it recognises a few starting points and the
 * edits listed in its fallback reply.
 */
function assist(text, spec, channels) {
  const t = text.toLowerCase(), s = { ...spec }, changed = new Set();
  const first = s.name === UNTITLED;
  if (first) {
    let tpl;
    if (/sample/.test(t)) tpl = { name: "Sample request reminder", what: "Reminds creators to request their free sample.", days: ["Fri"], time: "11:00", text: "Friday reminder 📦 Haven’t requested your free sample yet? Grab it in the affiliate links channel and post your first video this week." };
    else if (/streak|3 videos|three videos|post(ed)? (\d|three)|consisten/.test(t)) tpl = { name: "Video streak shoutout", what: "A weekly nudge to post 3 or more videos.", days: ["Sun"], time: "18:00", text: "🎬 Streak check! Who posted 3+ videos this week? Drop your best one below. That’s how winners are made." };
    else if (/inactive|haven.?t posted|win.?back|quiet|silent/.test(t)) tpl = { name: "Win-back nudge", what: "DMs creators a nudge to post again.", days: ["Mon"], time: "15:00", channel: "dm", mention: "none", text: "Hey {first_name}! Haven’t seen a video from you in a bit. Check this week’s winning angle to get going. Need a new sample? Just reply here." };
    else if (/tip|product|brief|talking point/.test(t)) tpl = { name: "Weekly product tip", what: "Posts one product tip every week.", days: ["Wed"], time: "13:00", text: "💡 Tip of the week: show the before and after in the first 3 seconds. Videos that open on the result hold attention longer." };
    else tpl = { name: "Custom post", what: text.slice(0, 120), days: ["Mon"], time: "12:00", text: text.replace(/^(every|each)\s+\w+,?\s*/i, "").replace(/^\w/, (m) => m.toUpperCase()) };
    Object.assign(s, tpl);
    ["name", "what", "schedule", "text", "channel", "mention"].forEach((k) => changed.add(k));
  }
  const day = Object.keys(DAY_WORDS).find((d) => t.includes(d));
  const tm = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (/every ?day|daily/.test(t)) { s.days = [...WEEKDAYS]; changed.add("schedule"); }
  else if (/weekdays/.test(t)) { s.days = WEEKDAYS.slice(0, 5); changed.add("schedule"); }
  else if (day) { s.days = [DAY_WORDS[day]]; changed.add("schedule"); }
  if (tm) {
    const h = (+tm[1] % 12) + (tm[3] === "pm" ? 12 : 0);
    s.time = String(h).padStart(2, "0") + ":" + (tm[2] || "00");
    changed.add("schedule");
  }
  const ch = (t.match(/#([a-z0-9-]+)/) || [])[1];
  const hit = ch && channels.find((c) => baseName(c.name).includes(ch));
  if (hit) { s.channel = hit.id; changed.add("channel"); }
  if (!first && /\bdm\b|direct message|privately/.test(t)) { s.channel = "dm"; s.mention = "none"; changed.add("channel").add("mention"); }
  if (/no (mention|tag|@here)|don.?t (tag|ping)|without @here/.test(t)) { s.mention = "none"; changed.add("mention"); }
  else if (/@everyone/.test(t)) { s.mention = "@everyone"; changed.add("mention"); }
  else if (!first && /@here/.test(t)) { s.mention = "@here"; changed.add("mention"); }
  if (/shorter|too long|concise/.test(t)) { s.text = s.text.split(/(?<=[.!?])\s/).slice(0, 2).join(" "); changed.add("text"); }
  if (!first && /more hype|hype|excit|energy/.test(t)) { s.text = s.text.replace(/\.$/, "") + " 🚀🔥"; changed.add("text"); }
  if (/no emoji|calmer|professional/.test(t)) { s.text = s.text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]️?/gu, "").replace(/\s{2,}/g, " ").trim(); changed.add("text"); }
  if (/skip approval|post automatically|no approval|auto.?post/.test(t)) { s.approval = false; changed.add("approval"); }
  else if (/needs? approval|approve first/.test(t)) { s.approval = true; changed.add("approval"); }
  const nm = text.match(/(?:call it|name it)\s+["“]?([^"”]+)["”]?/i);
  if (nm) { s.name = nm[1].trim().slice(0, 48); changed.add("name"); }
  const say = text.match(/(?:say|message should be|text:)\s+["“](.+)["”]/i);
  if (say) { s.text = say[1]; changed.add("text"); }

  let reply;
  if (first) reply = `Here’s a first draft: **${s.name}**.\n\n• Runs: ${daysTimeText(s.days, s.time)}\n• Posts to: ${s.channel === "dm" ? "a DM to each creator" : "the channel on the right"}\n• ${s.approval ? "Waits for approval first" : "Posts automatically"}\n\nCheck the preview on the right. The message is fixed text: edit it there, or tell me to make it shorter, calmer or more hype. Want a different day, time or channel?`;
  else if (changed.size) reply = "Done. I changed the " + [...changed].map((c) => ({ text: "message", what: "description" })[c] || c).join(", ") + ". Anything else?";
  else reply = "I didn’t find a change in that. I can set the day and time (“Tuesday at 3pm”, “every day”), the channel (“#share-wins” or “DM”), the mention (“no mention”, “@everyone”), the tone (“shorter”, “more hype”, “no emoji”), approval (“post automatically”), the name (“call it …”) or the text (say “…”). You can also edit the message directly on the right.";
  return { spec: s, reply, changed: [...changed] };
}

export default function Builder() {
  const { customs, autos, view, setView, go, chName, cfg, channels, saveCustom, toast, crmName } = useApp();
  const editing = customs.find((c) => c.id === view.cb) || null;
  const [spec, setSpec] = useState(() => (editing ? { ...fresh(""), ...editing } : fresh(autos.general_chat.channel || channels[0]?.id || "")));
  const [chat, setChat] = useState(() => editing?.chat || [["ai", HELLO]]);
  const [typing, setTyping] = useState(false);
  const [flash, setFlash] = useState([]);
  const [input, setInput] = useState("");
  const [deploy, setDeploy] = useState(false);
  const box = useRef(null);
  const untitled = spec.name === UNTITLED;

  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [chat, typing]);

  const send = (text) => {
    text = text.trim();
    if (!text || typing) return;
    setChat((c) => [...c, ["me", text]]);
    setInput("");
    setTyping(true);
    setTimeout(() => {
      const out = assist(text, spec, channels);
      setSpec(out.spec);
      setChat((c) => [...c, ["ai", out.reply]]);
      setFlash(out.changed);
      setTyping(false);
    }, 500);
  };
  const store = async (on, patch = {}) => {
    const id = editing?.id || view.cb || "cu" + Date.now().toString(36);
    const { id: _drop, ...clean } = { ...spec, ...patch };
    const ok = await saveCustom(id, { ...clean, on, chat, createdAt: editing?.createdAt || new Date().toISOString() });
    if (ok) setView({ cb: id });
    return ok;
  };
  const mention = spec.channel === "dm" || spec.mention === "none" ? "" : spec.mention + " ";
  const cls = (k) => (flash.includes(k) ? "flash" : "");

  return (
    <>
      <PageHead title={<><a href="#automations" style={{ color: "var(--color-text-muted)", fontSize: "var(--text-body-sm)", fontFamily: "var(--font-sans)", fontWeight: 500, display: "inline-flex", gap: 4, alignItems: "center" }}><Ico name="back" />Automations</a><br />Custom automation</>} desc="Describe it, refine it in chat, watch the preview, then deploy.">
        <button className="btn" type="button" onClick={() => { setView({ cb: null }); setSpec(fresh(autos.general_chat.channel || "")); setChat([["ai", HELLO]]); }}><Ico name="plus" />Start over</button>
        <button className="btn" type="button" disabled={untitled} onClick={async () => { if (await store(false)) toast("Saved as a draft. It’s paused until you deploy it."); }}>Save draft</button>
        <button className="btn primary" type="button" disabled={untitled} onClick={() => setDeploy(true)}><Ico name="bolt" />Save &amp; deploy</button>
      </PageHead>
      <div className="cab">
        <section className="chatbox" aria-label="Chat with the builder">
          <div className="ch-h"><span className="todo-i"><Ico name="spark" /></span><div><b>Kreo builder</b><div className="muted" style={{ fontSize: "var(--text-micro)" }}>Understands days, times, channels, mentions and tone</div></div></div>
          <div className="msgs" ref={box}>
            {chat.map(([who, t], i) => <div key={i} className={"bub " + (who === "ai" ? "ai" : "me")}>{t.split(/\*\*(.+?)\*\*/g).map((part, j) => (j % 2 ? <b key={j}>{part}</b> : part))}</div>)}
            {typing && <div className="bub ai"><span className="typing"><i /><i /><i /></span></div>}
          </div>
          {chat.length < 2 && <div className="sugg">{SUGGESTIONS.map((x) => <button key={x} className="chip" type="button" onClick={() => send(x)}>{x}</button>)}</div>}
          <form className="compose" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <textarea className="input" aria-label="Message" placeholder={chat.length < 2 ? "Describe your automation…" : "Ask for changes: day, time, channel, tone…"} value={input} disabled={typing} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} />
            <button className="btn primary" type="submit" aria-label="Send"><Ico name="send" /></button>
          </form>
        </section>
        <section className="prevbox" aria-label="Preview">
          <div className="ch-h" style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)", display: "flex", gap: 8, alignItems: "center" }}><b style={{ fontSize: "var(--text-caption)", color: "var(--color-heading)" }}>Live preview</b><span className="pill line" style={{ marginLeft: "auto" }}>{editing ? (editing.on ? "Live" : "Saved, paused") : "Not saved"}</span></div>
          <div className="pb">
            <div><div className="sec-t">{spec.name}</div><Dc channel={chName(spec.channel)} dm={spec.channel === "dm"} messages={[{ text: mention + spec.text.replace("{first_name}", "Lena") }]} /></div>
            {!untitled && <label className="field">Message<textarea className="input" value={spec.text} onChange={(e) => setSpec({ ...spec, text: e.target.value })} /><small>{spec.channel === "dm" ? "Use {first_name} for the creator’s name. Goes to every member the bot has welcomed by DM." : "This exact text is posted each time."}</small></label>}
            <div className="specs">
              <div className={cls("schedule")}><span>Runs</span><b>{daysTimeText(spec.days, spec.time)}</b></div>
              <div className={cls("channel")}><span>Posts to</span><b>{spec.channel === "dm" ? "Direct message" : spec.channel ? "#" + chName(spec.channel) : "No channel"}</b></div>
              <div><span>Uses</span><b>A fixed message (no {crmName} data)</b></div>
              <div className={cls("mention")}><span>Notify</span><b>{spec.channel === "dm" ? "No mention" : MENTIONS.find((m) => m[0] === spec.mention)?.[1]}</b></div>
              <div className={cls("approval")}><span>Approval</span><b>{spec.approval ? "Mods approve first" : "Posts automatically"}</b></div>
              <div className={cls("what")}><span>What it does</span><b>{spec.what || "—"}</b></div>
            </div>
          </div>
        </section>
      </div>
      {deploy && (
        <Dialog title={`Deploy “${spec.name}”`} onClose={() => setDeploy(false)} actions={<>
          <button className="btn" type="button" onClick={() => setDeploy(false)}>Cancel</button>
          <button className="btn primary" type="button" disabled={!spec.channel || !spec.days.length || !spec.time} onClick={async () => { if (await store(true)) { toast(`“${spec.name}” is live: ${daysTimeText(spec.days, spec.time)}`); go("automations"); } }}><Ico name="bolt" />Deploy</button>
        </>}>
          <label className="field">Posts to<ChanSelect value={spec.channel} onChange={(channel) => setSpec({ ...spec, channel })} none="Choose a channel…" dm /></label>
          <div className="field">Days<DayChips value={spec.days} onChange={(days) => setSpec({ ...spec, days })} /></div>
          <label className="field">Time<input className="input" type="time" value={spec.time} onChange={(e) => setSpec({ ...spec, time: e.target.value })} /><small>{cfg.timezone}</small></label>
          <div className="trow" style={{ border: 0, padding: 0 }}><div><b>Mods approve first</b><span>Each run waits in Approvals{cfg.modChannel ? " and #" + chName(cfg.modChannel) : ""}</span></div><Sw checked={spec.approval} label="Mods approve first" onChange={(approval) => setSpec({ ...spec, approval })} /></div>
        </Dialog>
      )}
    </>
  );
}
