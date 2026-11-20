/*
 * Health check: `npm run check` (add `-- --post` to also send each post to the
 * moderators' channel as a test).
 *
 * Checks the connections (Claude, Cruva, Discord, ffmpeg), then builds every
 * automation exactly as the schedule would, with your workspace's real settings and
 * data. Each post's text and card images are saved to backend/check-output/ so you
 * can open them. Nothing is posted to your public channels.
 */
import "../src/env.js";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import { sql, store } from "../src/store.js";
import { ai } from "../src/ai.js";
import { discord } from "../src/discord.js";
import { crmFor, crmSource, shopFor } from "../src/crm.js";
import { AUTO_NAMES, BUILD } from "../src/drafts.js";
import { autosOf, cfgOf, startJob } from "../src/jobs.js";
import { withCruvaMcp } from "../src/cruvaMcp.js";

const OUT = new URL("../check-output/", import.meta.url).pathname;
const POST = process.argv.includes("--post");
const ok = (s) => console.log("  ✅ " + s);
const bad = (s) => console.log("  ❌ " + s);
const warn = (s) => console.log("  ⚠️  " + s);
let failures = 0;

console.log("\n1. Connections");
// Claude
if (!ai.configured()) { bad("Claude: ANTHROPIC_API_KEY isn't set, so script cards and viral breakdowns fall back to plain text."); failures++; }
else {
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    await new Anthropic().models.list({ limit: 1 });
    ok(`Claude: key works (model ${process.env.ANTHROPIC_MODEL || "claude-opus-5-5"})`);
  } catch (e) { bad("Claude: the key was rejected: " + e.message); failures++; }
}
// Discord
const d = await discord.info();
d.configured ? ok(`Discord: bot "${d.bot.name}" is connected`) : (bad("Discord: " + (d.error || "DISCORD_BOT_TOKEN isn't set")), failures++);
// ffmpeg
const ff = spawnSync(process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg", ["-version"]);
ff.status === 0 ? ok("ffmpeg: ready (viral hooks can read video frames)") : (bad("ffmpeg: not found"), failures++);

// Workspace: the first owner whose email gets live Cruva data, else the first workspace.
const allowed = String(process.env.CRUVA_ALLOWED_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
const owner = sql.prepare("SELECT id, email FROM users WHERE workspace_id IS NULL ORDER BY created_at").all()
  .sort((a, b) => allowed.includes(b.email.toLowerCase()) - allowed.includes(a.email.toLowerCase()))[0];
if (!owner) { bad("No account found. Sign up in the app first."); process.exit(1); }
const ns = owner.id;
const ws = store.get(ns, "workspace/main") || {};
const crm = crmFor(ns);
const shop = await shopFor(ns, ws.shopId).catch((e) => (bad("Cruva: " + e.message), null));
if (!shop) process.exit(1);
crmSource(ns) === "cruva" ? ok(`Cruva: live data for ${shop.name}`) : warn(`Cruva: this workspace sees SAMPLE data (add its owner's email to CRUVA_ALLOWED_EMAILS for live data)`);
if (crmSource(ns) === "cruva") {
  try {
    const t = await withCruvaMcp(process.env.CRUVA_API_KEY, (call) => call("search_marketplace_products", { search: "shampoo", page_size: 1 }));
    /current plan/i.test(t) ? warn("Cruva market data: not enabled for this API key, so viral hooks uses your own shop's videos. Ask Cruva to enable marketplace data for API keys.") : ok("Cruva market data: enabled (viral hooks uses other brands' videos)");
  } catch (e) { warn("Cruva MCP: " + e.message); }
}
const gid = ws.guildId;
const cfg = gid ? cfgOf(ns, gid) : {};
const autos = gid ? autosOf(ns, gid) : {};
if (gid && !cfg.modChannel) warn("No approvals channel set (Settings → Channels), so drafts can't be tested in Discord.");

console.log(`\n2. Building every automation (${crmSource(ns)} data, saved to backend/check-output/)`);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const key of ["winning_content", "viral_hooks", "wins", "leaderboard"]) {
  const s = autos[key] || {};
  const t = Date.now();
  try {
    const msgs = await BUILD[key](shop, s, { crm, ns, tz: cfg.timezone });
    const dir = OUT + key + "/";
    mkdirSync(dir, { recursive: true });
    let images = 0;
    msgs.forEach((m, i) => {
      if (m.text) writeFileSync(`${dir}${i + 1}-message.txt`, m.text);
      for (const [j, u] of (m.images || []).entries()) {
        const id = /\/api\/media\/(.+)\.png$/.exec(u)?.[1];
        const f = id && store.media(id);
        if (f) { writeFileSync(`${dir}${i + 1}-card${j + 1}.png`, f.data); images++; }
      }
    });
    const secs = ((Date.now() - t) / 1000).toFixed(0);
    const empty = msgs.length === 1 && /^no |nothing selected/i.test(msgs[0].text || "");
    (empty ? warn : ok)(`${AUTO_NAMES[key]}: ${msgs.length} message${msgs.length === 1 ? "" : "s"}, ${images} card${images === 1 ? "" : "s"} (${secs}s)${empty ? `: "${msgs[0].text}"` : ""}${s.channel ? "" : " · no channel picked yet"}`);
    if (key === "viral_hooks" && !s.niche) warn("Viral hooks: no niche words set (Automations → Viral hooks).");
    if (POST && gid && cfg.modChannel && !empty) {
      const built = await startJob(ns, "draft", { automation: key, test: true }).done;
      const sent = built.status === "done" && (await startJob(ns, "test", { draftId: built.result.draftId }).done);
      sent?.status === "done" ? ok(`  sent to the approvals channel`) : bad(`  couldn't send to the approvals channel: ${sent?.error || built.error}`);
    }
  } catch (e) {
    bad(`${AUTO_NAMES[key]}: failed: ${e.message}`);
    failures++;
  }
}

console.log(failures ? `\n${failures} problem${failures === 1 ? "" : "s"} found.\n` : "\nAll good. Open backend/check-output/ to see each post.\n");
process.exit(failures ? 1 : 0);
