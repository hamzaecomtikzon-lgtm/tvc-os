import { useEffect, useState } from "react";
import { cacheKey, cached, callCached } from "../services/cruva.js";
import { useApp } from "../context/app.js";

/**
 * Load a Cruva tool result. Returns { data, error, loading }.
 * Cached per input; Refresh (refreshKey) clears the cache and refetches.
 */
export function useCruva(tool, input, enabled = true) {
  const { refreshKey } = useApp();
  const key = cacheKey(tool, input);
  const [res, setRes] = useState(() => (cached(key) ? { key, data: cached(key), error: null } : { key: null, data: null, error: null }));

  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    callCached(tool, JSON.parse(key.slice(tool.length + 1))).then(
      (data) => live && setRes({ key, data, error: null }),
      (error) => live && setRes({ key, data: null, error }),
    );
    return () => { live = false; };
  }, [tool, key, refreshKey, enabled]);

  const fresh = res.key === key;
  return { data: fresh ? res.data : null, error: fresh ? res.error : null, loading: !fresh };
}
