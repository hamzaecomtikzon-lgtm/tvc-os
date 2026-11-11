import { useState } from "react";
import { useApp } from "../context/app.js";
import { BUILDABLE } from "../lib/constants.js";

/** Ask Claude to build a test draft with the automation's real skill. Returns [busyKey, run]. */
export function useTestDraft() {
  const { request, toast } = useApp();
  const [busy, setBusy] = useState(null);
  const run = async (key, replaces) => {
    if (!BUILDABLE.includes(key)) {
      toast("Test posts for this automation aren’t set up yet");
      return;
    }
    setBusy(key);
    try {
      const sent = await request("draft", { automation: key, test: true, ...(replaces ? { replaces } : {}) });
      toast(sent ? "Claude is building it with the real skill. It appears in Approvals when ready." : "Saved. Ask Claude to process queued requests.");
    } finally {
      setBusy(null);
    }
  };
  return [busy, run];
}
