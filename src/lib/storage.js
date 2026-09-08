/* localStorage that degrades to memory rather than throwing.

   Private windows, embedded frames and locked-down corporate profiles
   can all make localStorage unavailable. The app should still run for
   the session in that case — it just won't remember anything after a
   reload, which is much better than a blank screen. */

const mem = new Map();

export const store = {
  get(k) {
    try { return localStorage.getItem(k); }
    catch { return mem.has(k) ? mem.get(k) : null; }
  },
  set(k, v) {
    try { localStorage.setItem(k, v); }
    catch { mem.set(k, v); }
  },
  del(k) {
    try { localStorage.removeItem(k); }
    catch { mem.delete(k); }
  }
};

/** Parse JSON from storage, returning `fallback` on anything unexpected. */
export function readJson(key, fallback) {
  try {
    const raw = store.get(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key, value) {
  try { store.set(key, JSON.stringify(value)); }
  catch { /* quota or serialisation failure — non-fatal */ }
}

export const KEYS = {
  settings: "pd.settings",
  tally: "pd.tally",
  quota: "pd.quota",
  tavilyQuota: "pd.tavilyQuota",
  items: "pd.items",
  searchCache: "pd.searchCache",
  theme: "pd.theme"
};
