/*
 * The model behind the general chat manager. Optional: without ANTHROPIC_API_KEY
 * in backend/.env the chat manager stays off and everything else works.
 */
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
let client = null;

const str = { type: "string" };
const obj = (props) => ({ type: "object", additionalProperties: false, required: Object.keys(props), properties: props });
const WINNING_SCHEMA = obj({
  product_short: str,
  angle: obj({ line: str, highlight: str, translation: str, summary: str }),
  why_heading: str,
  why: { type: "array", items: obj({ title: str, title_note: str, body: str }) },
  script: { type: "array", items: obj({ label: str, line: str, translation: str, hook_index: { type: "integer" } }) },
  diagnosis_body: str,
  opening: obj({ line: str, translation: str, note: str }),
  replicate: { type: "array", items: obj({ title: str, line: str, translation: str }) },
  checklist: { type: "array", items: str },
  closing: str,
});
const VIRAL_SCHEMA = obj({
  product_short: str,
  hook_title: str,
  hook_translation: str,
  hook_note: str,
  why: str,
  beats: { type: "array", items: obj({ title: str, body: str }) },
  adapt_name: str,
  adapt_intro: str,
  steps: { type: "array", items: obj({ title: str, action: str, line: str, translation: str }) },
  on_brief: { type: "array", items: str },
});

/** Keep an AI-designed server layout inside what the builder and Discord accept. `autos` are the automation slots it may use. */
export function tidyCommunity(out, autos) {
  const used = new Set();
  const seen = new Set();
  const clean = (n) => String(n || "").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-_]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  let cats = (out.cats || []).filter((c) => !/MODERATOR/i.test(c.cat)).slice(0, 7).map((c) => ({
    cat: String(c.cat).slice(0, 40), about: String(c.about || "").slice(0, 160), priv: false,
    ch: (c.ch || []).map((x) => {
      const name = clean(x.name);
      if (!name || seen.has(name) || name === "moderator-only") return null;
      seen.add(name);
      const auto = x.auto && x.auto !== "mod" && autos.includes(x.auto) && !used.has(x.auto) ? x.auto : "";
      if (auto) used.add(auto);
      return { e: [...String(x.e || "")].slice(0, 2).join(""), name, perm: x.perm === "read" ? "read" : "everyone", desc: String(x.desc || "").slice(0, 120), ...(auto ? { auto } : {}) };
    }).filter(Boolean),
  })).filter((c) => c.ch.length);
  const modCat = (out.cats || []).find((c) => /MODERATOR/i.test(c.cat));
  const modExtra = (modCat?.ch || []).map((x) => ({ name: clean(x.name), desc: String(x.desc || "").slice(0, 120) }))
    .filter((x) => x.name && x.name !== "moderator-only" && !seen.has(x.name)).slice(0, 3)
    .map((x) => ({ e: "", name: x.name, perm: "mods", desc: x.desc }));
  // Discord channel creation is capped at 40 per run, moderators included.
  let room = 40 - 1 - modExtra.length;
  cats = cats.map((c) => { const keep = c.ch.slice(0, Math.max(0, room)); room -= keep.length; return { ...c, ch: keep }; }).filter((c) => c.ch.length);
  if (!cats.length) return null;
  cats.push({ cat: "🔒 MODERATORS", about: "Hidden from creators. Only your mods and the bot can see it.", priv: true, ch: [{ e: "", name: "moderator-only", perm: "mods", desc: "Every draft waits here for approval", auto: "mod" }, ...modExtra] });
  return { name: String(out.name || "Custom layout").slice(0, 40), tagline: String(out.tagline || "").slice(0, 200), cats };
}

export const ai = {
  configured: () => Boolean(process.env.ANTHROPIC_API_KEY),

  /**
   * Decide how to answer one message in the community's general chat.
   * Returns `{ action: "reply" | "escalate" | "skip", text }`.
   */
  async chatReply({ brand, server, botName, voice, escalate, history, author, message }) {
    client ||= new Anthropic();
    const system = [
      `You are ${botName}, the community lead for ${brand}'s TikTok Shop creator community on Discord (server: ${server}).`,
      "Creators here make affiliate videos for the brand. You answer their questions in the general chat the way a friendly, switched-on community manager would: short (one to three sentences), concrete, encouraging.",
      voice ? `The brand's voice notes: ${voice}` : "",
      `Some topics must go to the human team instead of being answered by you: ${escalate || "refunds, missing commission, payments, complaints, legal, medical claims"}. Also escalate anything you don't actually know (order status, a specific creator's samples or payouts, commission rates, dates). Never invent facts about the brand, its products or its policies.`,
      "The first line of your answer is exactly one word: REPLY, ESCALATE or SKIP.",
      "REPLY: the following lines are the message to post. ESCALATE: the following lines are one sentence for the moderators saying what the creator needs. SKIP: the message doesn't need an answer from you (banter between creators, a reaction, something already answered).",
    ].filter(Boolean).join("\n\n");
    const recent = history.length ? "Recent messages in the channel:\n" + history.map((h) => `${h.who}: ${h.text}`).join("\n") + "\n\n" : "";
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system,
      messages: [{ role: "user", content: `${recent}New message from ${author}:\n${message}` }],
    });
    if (res.stop_reason === "refusal") return { action: "skip", text: "" };
    const out = res.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    const [first, ...rest] = out.split("\n");
    const action = { REPLY: "reply", ESCALATE: "escalate" }[first.trim().toUpperCase()] || "skip";
    return { action, text: rest.join("\n").trim() };
  },

  /**
   * Break down the week's winning video for the winning-angle post: the angle, why it sells,
   * the script beat by beat, a better opening and remake steps. Returns the parsed object
   * (shape in WINNING_SCHEMA), or null when the model declined.
   */
  async winningAngle({ brand, voice, video, stats }) {
    client ||= new Anthropic();
    const system = [
      `You are the community lead for ${brand}'s TikTok Shop affiliate creator community. Every week you break down the #1 video by GMV so other creators can remake its angle.`,
      "You get the video's transcript, the hooks the CRM detected (with 1-10 scores), and its numbers. Write a breakdown that is specific to THIS video: quote its real lines, name its real product and problem. Nothing generic.",
      "Language: quote lines exactly in the video's own language (fix only obvious transcription errors, and you may shorten with … ). When the video is not in English, give a short natural English translation for every quoted line; when it is in English, leave every translation field empty.",
      "Fields:",
      "- product_short: the product in 2-4 words, the way a creator would say it (e.g. \"Ketoconazole Shampoo\").",
      "- angle.line: the angle as one short punchy line in the video's language, 4-9 words, built from the creator's own words (e.g. \"Lo único que me curó, en 7 días\"). angle.highlight: the exact trailing words of angle.line that carry the payoff (a timeline, result or number), to color green. angle.translation: English translation (empty for English videos). angle.summary: one English sentence saying what the creator does, using the @handle (e.g. \"@x shows their own scalp, then the one shampoo that fixed it.\").",
      "- why_heading: \"Why this angle sells a <product category>\" (e.g. \"Why this angle sells a scalp shampoo\").",
      "- why: exactly 3 reasons. title: 2-5 words (may be a quoted phrase from the video); title_note: English gloss if the title is a non-English phrase, else empty; body: one sentence, max 16 words.",
      "- script: the video's beats in the order they happen, 5-7 rows (merge small beats, e.g. ingredients and origin are one PROOF row). label: one or two words in English caps style (PROBLEM, THE FIX, PROOF, SYMPTOMS, DEMO, RESULT, CART, ASK…). line: the creator's actual words for that beat, max 12 words (trim with …). translation as above. hook_index: the index (0-based) of the detected hook this line matches, or -1.",
      "- diagnosis_body: one sentence (max 18 words) that follows the words \"X% swiped in 2 seconds.\" (already shown, so don't repeat the percentage) and says which strong lines came too late, e.g. \"Their best line (9/10) came second and '7 días' came last.\" Refer to the creator by @handle or as \"their\", never he/she.",
      "- opening: a better first line made by reordering the creator's own strongest lines (no new claims). line, translation, note (one short English sentence on what to show on screen and in what order).",
      "- replicate: exactly 5 steps another creator follows to remake this angle with their own face and the same product. title: short imperative ending in a colon-free phrase (e.g. \"Open on your own scalp, close up\"). line: a sample line to say, in the video's language. translation as above. If a step is an action rather than a line, line may describe it in English and translation is empty.",
      "- checklist: 4-6 items, 1-3 words each.",
      "- closing: one bold motivating sentence tying the hold-rate problem to what the creator should do (max 20 words).",
      "Never invent results, prices, discounts, commission rates or medical claims beyond what the creator said. Plain, punchy, creator-friendly English.",
      voice ? `Brand voice notes: ${voice}` : "",
    ].filter(Boolean).join("\n");

    const hooks = (video.hooks || []).map((x, i) => `${i}. [${x.score ?? "?"}/10] ${x.hook}`).join("\n") || "(none detected)";
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: WINNING_SCHEMA } },
      system,
      messages: [{
        role: "user",
        content: [
          `Creator: @${video.handle}`,
          `Product listing title: ${video.title || video.product || "unknown"}`,
          `Summary of the video: ${video.content_overview || "n/a"}`,
          `Transcript:\n${video.transcript || "(no transcript; work from the hooks and summary)"}`,
          `Detected hooks:\n${hooks}`,
          `Numbers this week: ${stats}`,
        ].join("\n\n"),
      }],
    });
    if (res.stop_reason === "refusal") return null;
    return JSON.parse(res.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
  },

  /**
   * Break down a viral video from the niche (usually another brand's) and adapt it to the
   * brand's product. `frames` is `[{ t, jpg }]` (may be empty). Returns VIRAL_SCHEMA's shape, or null.
   */
  async viralAngle({ brand, voice, video, frames, duration, caption, product, rules, language }) {
    client ||= new Anthropic();
    const system = [
      `You are the community lead for ${brand}'s TikTok Shop affiliate creator community. Every day this week you break down one of the niche's most-viewed videos from last week, often from another brand, so ${brand}'s creators can steal the hook and use it for ${brand}'s product.`,
      frames.length
        ? "You get frames from the video, each labelled with its second. Describe only what you can actually see in them: what is in frame one, when the product appears, what the hands do, on-screen text, setting, energy, length. Use real timestamps (\"at second 2\", \"by second 6\")."
        : "You don't have the video's frames, only its text data. Don't invent visual details or timestamps you can't know; work from the transcript, hooks and summary.",
      "Refer to the creator by @handle or as \"they\"/\"their\", never he/she.",
      "Fields:",
      "- product_short: the video's product in 3-6 words (e.g. \"Head & Shoulders Clinical Strength Shampoo\").",
      "- hook_title: the hook in a few words. If the hook is a line said or shown on screen, put that exact line in quotes in its original language (e.g. \"\\\"Dile adiós a la caspa con este shampoo\\\"\"); otherwise a short lowercase visual description (e.g. \"two bottles up, already talking\").",
      "- hook_translation: English translation of a non-English hook_title line, else empty. Quote on-screen or spoken lines with obvious typos fixed (e.g. \"a Dios\" → \"adiós\"), and never comment on the typo.",
      "- hook_note: one short lowercase line about frame one (e.g. \"on screen from second 1, bottle already in her hand\" or \"frame one: a bottle in each hand pushed toward the camera, mid-sentence, product name on screen\").",
      "- why: two or three short sentences on why the hook stops the scroll. If the video also sold (GMV > 0), say so.",
      "- beats: exactly 4 beats after the hook, in order. title: short, with a timestamp where you have one (e.g. \"Texture by second 2\"); body: one or two plain sentences on what happens and why it works.",
      `- adapt_name: what to call ${brand}'s product in the heading, 2-4 words without the brand name (e.g. \"keto bundle\").`,
      "- adapt_intro: one short line on how the move transfers (e.g. \"Fast and simple: say the promise, show the texture, show all three.\").",
      `- steps: exactly 5 steps for a creator remaking this with ${brand}'s product. title: short instruction. action: what to do or show, in English (may be empty). line: a line to say, in ${language || "the video's language"} (may be empty). translation: English translation of a non-English line, else empty.`,
      "- on_brief: the brand's content rules as 3-6 short items (from the rules given; empty array if none are given).",
      "Plain, punchy, creator-friendly English. Never invent claims, prices, discounts or results for the brand's product beyond its description.",
      voice ? `Brand voice notes: ${voice}` : "",
    ].filter(Boolean).join("\n");

    const content = [];
    for (const f of frames) {
      content.push({ type: "text", text: `Second ${f.t}:` });
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: f.jpg.toString("base64") } });
    }
    content.push({
      type: "text",
      text: [
        `Video: @${video.handle} · ${video.views} views · ${video.gmv ? "GMV " + video.gmv : "no tracked sales"} · ${duration ? duration + " seconds long" : "length unknown"}`,
        `Product in the video: ${video.product}`,
        caption ? `Caption: ${caption}` : "",
        video.overview ? `Summary: ${video.overview}` : "",
        video.transcript ? `Transcript: ${video.transcript}` : "",
        video.hooks?.length ? "Detected hooks:\n" + video.hooks.map((h) => `- [${h.score}/10] ${h.hook}`).join("\n") : "",
        `${brand}'s product to adapt it to: ${product}`,
        rules ? `${brand}'s content rules: ${rules}` : "No content rules given.",
      ].filter(Boolean).join("\n"),
    });
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: VIRAL_SCHEMA } },
      system,
      messages: [{ role: "user", content }],
    });
    if (res.stop_reason === "refusal") return null;
    return JSON.parse(res.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
  },

  /**
   * The custom automation builder chat: turn the user's latest message into an
   * updated automation spec plus a short reply. Returns `{ reply, spec }`, or
   * null when the model declined.
   */
  async buildAutomation({ brand, botName, voice, channels, spec, chat, message }) {
    client ||= new Anthropic();
    const ids = channels.map((c) => c.id);
    const system = [
      `You help a brand set up a scheduled Discord automation for ${brand}'s TikTok Shop creator community. The bot posting it is called ${botName}.`,
      "The user describes what they want in plain words and then asks for changes. Each turn, return the full updated automation and a short reply.",
      "The automation posts one fixed message on a weekly schedule. It cannot read sales data, video stats or creator lists, so write a message that works without them. If the user asks for something that needs live data (leaderboards, who posted, GMV), say briefly that a custom automation posts fixed text and suggest the closest thing it can do; the built-in automations cover leaderboards and wins.",
      "Fields: name (short title, max 48 chars); what (one sentence describing it); days (weekdays it runs, from Mon Tue Wed Thu Fri Sat Sun); time (24-hour HH:MM, or empty if not chosen yet); channel (one of the channel ids listed below, or \"dm\" to DM every welcomed creator); mention (\"@here\", \"@everyone\" or \"none\"; always \"none\" for dm); approval (true if moderators approve each run before it posts); text (the exact Discord message, under 600 characters, Discord markdown allowed; in DMs {first_name} is replaced with the creator's first name).",
      "Keep fields the user didn't ask to change exactly as they are. For a brand-new automation, choose sensible defaults: a fitting day and time, the most relevant channel, @here, approval on.",
      "Messages sound like a friendly, energetic community manager talking to creators: concrete, short, a few emoji at most. Never invent discount codes, prices, commission rates or product claims.",
      voice ? `Brand voice notes: ${voice}` : "",
      "reply: one to three short sentences telling the user what you set or changed, and optionally one question. Use **bold** for the automation name only.",
      "Channels:\n" + (channels.length ? channels.map((c) => `${c.id}: #${c.name}`).join("\n") : "(none yet; use \"dm\" or leave channel empty)"),
    ].filter(Boolean).join("\n\n");

    const history = chat.slice(-12).map(([who, t]) => `${who === "ai" ? "Builder" : "User"}: ${t}`).join("\n");
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["reply", "spec"],
            properties: {
              reply: { type: "string" },
              spec: {
                type: "object",
                additionalProperties: false,
                required: ["name", "what", "days", "time", "channel", "mention", "approval", "text"],
                properties: {
                  name: { type: "string" },
                  what: { type: "string" },
                  days: { type: "array", items: { type: "string", enum: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] } },
                  time: { type: "string" },
                  channel: { type: "string" },
                  mention: { type: "string", enum: ["@here", "@everyone", "none"] },
                  approval: { type: "boolean" },
                  text: { type: "string" },
                },
              },
            },
          },
        },
      },
      system,
      messages: [{
        role: "user",
        content: `Current automation:\n${JSON.stringify(spec)}\n\n${history ? "Conversation so far:\n" + history + "\n\n" : ""}User's new message:\n${message}`,
      }],
    });
    if (res.stop_reason === "refusal") return null;
    const out = JSON.parse(res.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
    const s = out.spec;
    // Keep the model's choices inside what the app can actually run.
    if (s.channel !== "dm" && !ids.includes(s.channel)) s.channel = ids.includes(spec.channel) || spec.channel === "dm" ? spec.channel : "";
    if (s.channel === "dm") s.mention = "none";
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)) s.time = "";
    s.days = [...new Set(s.days)];
    s.name = s.name.slice(0, 48) || spec.name;
    s.text = s.text.slice(0, 1900);
    return { reply: out.reply, spec: s };
  },

  /**
   * Design a Discord server layout for a creator community from a plain description.
   * Returns `{ name, tagline, cats: [{ cat, about, priv, ch: [{ e, name, perm, desc, auto }] }] }`,
   * already checked: valid channel names and permissions, each automation used at most once,
   * and a private moderators category holding the approvals channel. Null when the model declined.
   */
  async communityTemplate({ brand, description }) {
    client ||= new Anthropic();
    const AUTOS = {
      onboarding: "welcome channel where the bot greets new members (read-only)",
      general_chat: "main chat the bot answers in (everyone can chat)",
      winning_content: "weekly breakdown of the top-selling videos (read-only)",
      viral_hooks: "daily viral hooks from the niche (read-only)",
      wins: "milestone cards when creators hit sales milestones (everyone can chat)",
      leaderboard: "Monday top-5 creators by sales (read-only)",
    };
    const system = [
      `You design Discord servers for ${brand || "a brand"}'s TikTok Shop creator community: affiliate creators who post videos and earn commission.`,
      "Design a layout that fits the description: 3 to 6 categories plus a final private moderators category, 6 to 24 channels in total.",
      "Category names are an emoji, a space, then UPPERCASE words (e.g. \"🎓 START HERE\"). Each category has a one-sentence `about`.",
      "Channels: `e` is one emoji; `name` is lowercase words joined by hyphens, no emoji, max 30 characters; `perm` is \"everyone\" (creators can chat), \"read\" (announcement-style, bot and team post) or \"mods\" (only in the moderators category); `desc` is a short line saying what it's for.",
      "Wire the bot's automations to channels with `auto`. Use each of these at most once, and use most of them unless the description says otherwise. Every other channel has auto \"\".\n" + Object.entries(AUTOS).map(([k, v]) => `- ${k}: ${v}`).join("\n"),
      "The last category must be \"🔒 MODERATORS\" with priv true, starting with a channel named moderator-only, perm \"mods\", auto \"mod\" (where drafts wait for approval). All other categories have priv false.",
      "`name` is a 2 to 4 word title for the layout, `tagline` one sentence on what makes it fit.",
      "Write plain, concrete descriptions. Don't invent commission rates, prices or promises.",
    ].join("\n\n");
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 6000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: obj({
            name: str, tagline: str,
            cats: { type: "array", items: obj({ cat: str, about: str, priv: { type: "boolean" }, ch: { type: "array", items: obj({ e: str, name: str, perm: { type: "string", enum: ["everyone", "read", "mods"] }, desc: str, auto: { type: "string", enum: ["", "mod", ...Object.keys(AUTOS)] } }) } }) },
          }),
        },
      },
      system,
      messages: [{ role: "user", content: `Describe the community:\n${description}` }],
    });
    if (res.stop_reason === "refusal") return null;
    const out = JSON.parse(res.content.filter((b) => b.type === "text").map((b) => b.text).join(""));

    return tidyCommunity(out, Object.keys(AUTOS));
  },

  /**
   * KREO creator search: turn a brand's plain-words request ("L1 or L2 health creators in the US with
   * 10k+ followers") into filters. Returns `{ levels, niches, countries, minFollowers, maxFollowers,
   * minGmv, maxGmv, text, sort, summary }` (0 means no limit), or null when the model declined.
   */
  async creatorQuery({ query, niches, countries, levels }) {
    client ||= new Anthropic();
    const system = [
      "You turn a brand's request for TikTok Shop creators into search filters for a creator database. Only fill a filter when the request asks for it; leave the rest empty (empty list, 0, or \"\").",
      "levels: TikTok creator levels as integers 0–7. The ladder (by 30-day GMV): " + levels.map((l) => `L${l.level} ${l.badge}`).join(", ") + ". \"L2+\" means 2 through 7; a badge name (\"gold\") means its level.",
      "niches: from this list only: " + niches.join("; ") + ". Map words like supplements, vitamins, wellness → Health & wellness; skincare, makeup → Beauty & skincare.",
      "countries: ISO codes from this list only: " + countries.map(([c, n]) => `${c} (${n})`).join(", ") + ".",
      "minFollowers / maxFollowers: TikTok followers. minGmv / maxGmv: 30-day GMV in US dollars. \"10k\" = 10000, \"1.5M\" = 1500000.",
      "text: leftover words to match against handles or names (usually empty).",
      "sort: gmv (default), followers, level or newest.",
      "summary: one short sentence describing what you searched for, e.g. \"L1–L2 health creators in the US with 10k+ followers\".",
    ].join("\n\n");
    const int = { type: "integer" };
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 1500,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: obj({
            levels: { type: "array", items: int },
            niches: { type: "array", items: { type: "string", enum: niches } },
            countries: { type: "array", items: { type: "string", enum: countries.map(([c]) => c) } },
            minFollowers: int, maxFollowers: int, minGmv: int, maxGmv: int,
            text: str,
            sort: { type: "string", enum: ["gmv", "followers", "level", "newest"] },
            summary: str,
          }),
        },
      },
      system,
      messages: [{ role: "user", content: query.slice(0, 500) }],
    });
    if (res.stop_reason === "refusal") return null;
    return JSON.parse(res.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
  },
};
