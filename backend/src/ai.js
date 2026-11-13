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
};
