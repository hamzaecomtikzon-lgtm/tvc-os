/* AI helper. The demo returns curated suggestions; wire to a model endpoint in production. */
export const AI_AVAILABLE = true;

export async function suggestOnboardingQuestions(brand) {
  await new Promise((r) => setTimeout(r, 900));
  return [
    "What’s your TikTok handle? Drop it with the @ so we can link you up",
    "What’s your content vibe: skincare routines, GRWM, reviews or something else?",
    `Have you tried any ${brand || "brand"} products yet? Which one would you film first?`,
    "Have you sold on TikTok Shop before? Roughly how much in a good month?",
    "What would help you most right now: free samples, hook ideas or a commission boost?",
  ];
}
