import { store, readJson, KEYS } from "./storage.js";

/* ============================================================
   Saved searches

   Tavily's 1,000/month is the ceiling that actually binds this app, and
   a credit was previously spent every single time a part number ran —
   including a retry that only ever needed the writing redone, and
   including a part a colleague on the same key had already looked up.
   Results are now kept, keyed by the part number and the inputs that
   would change what gets asked.

   Deliberately not cached: a search that came back with zero sources.
   Storing that would make the retry button useless in exactly the case
   where re-searching is the whole point.
   ============================================================ */

const BUDGET = 2500000;

let cache = readJson(KEYS.searchCache, {});
if (!cache || typeof cache !== "object") cache = {};

export function searchCacheKey(part, opts, maxResults) {
  // Condition never changes what gets searched for — only what the
  // writing step is told to state — so it stays out of the key.
  return [
    String(part).trim().toUpperCase(),
    String(opts?.brand || "").trim().toUpperCase(),
    maxResults
  ].join("|");
}

function persist() {
  try {
    let json = JSON.stringify(cache);
    while (json.length > BUDGET) {
      const keys = Object.keys(cache);
      if (keys.length <= 1) break;
      let oldest = keys[0];
      for (const k of keys) if ((cache[k]?.at || 0) < (cache[oldest]?.at || 0)) oldest = k;
      delete cache[oldest];
      json = JSON.stringify(cache);
    }
    store.set(KEYS.searchCache, json);
  } catch { /* quota — non-fatal, the cache is an optimisation */ }
}

export function searchCacheGet(key, settings) {
  /* 0 means off. Without this, a just-written entry has an age of
     roughly zero days, which is not *greater* than the zero-day limit,
     so it would sail through the expiry check and be reused — the exact
     opposite of what the setting says it does. */
  if (!settings.cacheDays) return null;

  const hit = cache[key];
  if (!hit || !Array.isArray(hit.sources) || !hit.sources.length) return null;

  const ageDays = (Date.now() - (hit.at || 0)) / 86400000;
  if (ageDays > settings.cacheDays) {
    delete cache[key];
    persist();
    return null;
  }
  return hit;
}

export function searchCachePut(key, query, sources, settings) {
  if (!settings.cacheDays) return;
  if (!sources.length) return; // see note above
  cache[key] = { at: Date.now(), query, sources };
  persist();
}

export function searchCacheCount() {
  return Object.keys(cache).length;
}

export function searchCacheClear() {
  const n = searchCacheCount();
  cache = {};
  persist();
  return n;
}
