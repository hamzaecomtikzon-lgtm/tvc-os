/*
 * The model behind the general chat manager. Optional: without ANTHROPIC_API_KEY
 * in backend/.env the chat manager stays off and everything else works.
 */
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
let client = null;

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
};
