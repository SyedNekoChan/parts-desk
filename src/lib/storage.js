/* localStorage that degrades to memory rather than throwing.

   Private windows, embedded frames and locked-down corporate profiles
   can all make localStorage unavailable. The app should still run for
   the session in that case — it just won't remember anything after a
   reload, which is much better than a blank screen.

   A key that has fallen back to memory (quota exceeded, or storage
   unavailable) is tracked explicitly. Without that, a later successful
   getItem() on some *other* key gave no signal about this one, so a
   caller had no way to know its last write never reached disk. */

const mem = new Map();
const failed = new Set();

export const store = {
  get(k) {
    if (failed.has(k)) return mem.has(k) ? mem.get(k) : null;
    try { return localStorage.getItem(k); }
    catch { return mem.has(k) ? mem.get(k) : null; }
  },
  /** Returns true if the value actually reached localStorage. */
  set(k, v) {
    try {
      localStorage.setItem(k, v);
      failed.delete(k);
      return true;
    } catch {
      mem.set(k, v);
      failed.add(k);
      return false;
    }
  },
  del(k) {
    failed.delete(k);
    mem.delete(k);
    try { localStorage.removeItem(k); }
    catch { /* nothing to do if it was never there */ }
  },
  /** True if this key's last write only made it to the in-memory shadow. */
  isDegraded(k) {
    return failed.has(k);
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

/** Returns true if the write reached localStorage, false if it degraded
 *  to the in-memory shadow (quota or serialisation failure). */
export function writeJson(key, value) {
  try { return store.set(key, JSON.stringify(value)); }
  catch { return false; }
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
