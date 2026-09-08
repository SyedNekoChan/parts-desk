/* ============================================================
   Transport

   Two deployment shapes, one code path.

   1. No backend (the GitHub Pages default). The browser calls Mistral
      and Tavily directly with the operator's own key. Nothing is
      shared, nothing is server-side, and each person's free-tier
      allowance is their own.

   2. Optional proxy (server/app.js). Set VITE_API_BASE at build time
      and the same calls route through your own server instead. The
      only reason to want this is CORS: if a browser refuses the direct
      Tavily call, a proxy fixes it.

   In both shapes the key travels from the operator's browser and is
   never stored server-side. That is deliberate — a shared server-side
   key would mean one account absorbing everyone's usage, which is
   exactly the arrangement that ends in a bill.
   ============================================================ */

const BASE = (import.meta.env?.VITE_API_BASE || "").replace(/\/$/, "");

export const usingProxy = Boolean(BASE);

export const ENDPOINTS = {
  mistralChat: BASE ? `${BASE}/api/mistral/chat` : "https://api.mistral.ai/v1/chat/completions",
  mistralModels: BASE ? `${BASE}/api/mistral/models` : "https://api.mistral.ai/v1/models",
  tavilySearch: BASE ? `${BASE}/api/tavily/search` : "https://api.tavily.com/search"
};

/* No request in the original app had a timeout. A connection that opens
   and then never answers — not an error status, just silence — would
   hang the await forever, and because the queue runs strictly in series
   that one part number would stall the entire remaining batch with the
   spinner still turning. */
export const REQUEST_TIMEOUT_MS = 90000;

export function withTimeout(signal, ms = REQUEST_TIMEOUT_MS) {
  const timer = typeof AbortSignal !== "undefined" && AbortSignal.timeout
    ? AbortSignal.timeout(ms)
    : null;
  if (!timer) return signal;
  if (!signal) return timer;
  if (AbortSignal.any) return AbortSignal.any([signal, timer]);
  return signal; // very old browser: keep the user's abort, lose the timeout
}

export function isTimeout(e) {
  return e?.name === "TimeoutError" ||
    (e?.name === "AbortError" && String(e?.message || "").includes("timed out"));
}

/* When proxying, the provider key rides in a custom header rather than
   Authorization, so the proxy can attach it to the upstream call
   without ever needing one of its own. */
export function authHeaders(key) {
  return usingProxy
    ? { "x-provider-key": key }
    : { authorization: "Bearer " + key };
}

export async function readJsonBody(res) {
  try { return await res.json(); }
  catch { return null; }
}
