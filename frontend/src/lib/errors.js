/** Human-readable message for a data-source error. */
export function errMsg(e) {
  const c = e && e.code;
  if (c === "needs_reauth") return "Cruva needs reconnecting: Settings → Connectors → Cruva. Then press Refresh.";
  if (c === "server_not_connected" || c === "selection_required") return "Cruva isn’t connected for you. Add it in Settings → Connectors.";
  if (c === "not_in_manifest" || c === "not_granted" || c === "consent_required")
    return "This page isn’t allowed to read Cruva for you. Allow Cruva when asked, then press Refresh.";
  if (c === "server_unavailable" || c === "rate_limited") return "Cruva didn’t answer in time. Press Refresh in a moment.";
  if (c === "tool_error") return "Cruva returned an error: " + (e.message || "unknown") + ".";
  return "Couldn’t load this (" + (c || e?.message || "error") + "). Press Refresh to try again.";
}
