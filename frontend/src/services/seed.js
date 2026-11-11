/*
 * First-run demo workspace: a connected server, channels assigned and a brand
 * picked, so every page (Automations included) opens ready to use.
 * The setup guide stays available from the sidebar; "Reset demo" clears this.
 */
import { db } from "./db.js";
import { HOME_GUILD, SHOPS, genActivity, guildDoc, seedResponses } from "./mockData.js";
import { AUTOS, DEFAULT_TONE, defaultAutos, guessChannel } from "../lib/constants.js";

export function seedDemoIfNeeded() {
  const ws = db.get("workspace/main");
  if (ws && (ws.done || ws.guildId)) return; // user has (or is doing) their own setup

  const g = guildDoc();
  const now = new Date().toISOString();
  const autos = defaultAutos(g.channels);
  const modChannel = guessChannel(g.channels, ["moderator-only"]);
  const allowIds = new Set(AUTOS.map((a) => autos[a.key]).filter((s) => s.enabled && s.channel).map((s) => s.channel));
  if (modChannel) allowIds.add(modChannel);
  const allow = [...allowIds]
    .map((id) => ({ id, name: g.channels.find((c) => c.id === id)?.name || "" }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const entries = [
    { path: "discord/" + HOME_GUILD, data: g },
    { path: "config/" + HOME_GUILD, data: { guild: HOME_GUILD, botName: g.botName, tone: DEFAULT_TONE, modChannel, approverRole: "" } },
    { path: "automations/" + HOME_GUILD, data: { guild: HOME_GUILD, items: autos, updatedAt: now } },
    { path: "allowlist/" + HOME_GUILD, data: { guild: HOME_GUILD, channels: allow, updatedAt: now, syncedAt: now } },
    { path: "workspace/main", data: { guildId: HOME_GUILD, shopId: SHOPS[0].id, channelsDone: true, done: true } },
  ];
  if (!db.count("activity")) entries.push(...genActivity(HOME_GUILD));
  if (!db.count("onboarding_responses")) entries.push(...seedResponses(HOME_GUILD));
  // setMany writes synchronously; a storage error only skips persistence.
  db.setMany(entries).catch(() => {});
}
