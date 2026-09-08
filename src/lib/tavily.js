import { ENDPOINTS, authHeaders, withTimeout, isTimeout, readJsonBody, REQUEST_TIMEOUT_MS, usingProxy } from "./api.js";

/* Returns Tavily's own structured results — never scraped or
   regex-extracted — so a listing can never cite a page Tavily didn't
   actually return. */
export async function tavilySearch(query, apiKey, maxResults, signal) {
  let res;
  try {
    res = await fetch(ENDPOINTS.tavilySearch, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(apiKey) },
      body: JSON.stringify({ query, max_results: maxResults, search_depth: "basic" }),
      signal: withTimeout(signal)
    });
  } catch (e) {
    if (isTimeout(e)) throw new Error(`Tavily didn't answer within ${REQUEST_TIMEOUT_MS / 1000} seconds. Try this part number again.`);
    if (e.name === "AbortError") throw e;

    /* A fetch that throws before ever reaching a response (rather than
       an HTTP error status) usually means the browser blocked the
       request outright — most commonly CORS. Worth naming explicitly,
       since the fix is completely different from a real API error. */
    throw new Error(
      usingProxy
        ? "Couldn't reach the search proxy. Check that the server in server/app.js is running and that VITE_API_BASE points at it."
        : "Couldn't reach Tavily. If this happens on every attempt, the browser is probably blocking the request (a CORS restriction) rather than Tavily being down. Running the proxy in server/app.js and rebuilding with VITE_API_BASE set is the fix."
    );
  }

  const payload = await readJsonBody(res);
  if (!res.ok) {
    const msg = payload?.detail?.error || payload?.error || `Tavily returned ${res.status}.`;
    const err = new Error(`Tavily search failed: ${msg}`);
    err._status = res.status;
    throw err;
  }

  const sources = (payload?.results || [])
    .filter(r => r?.url)
    .map(r => ({
      title: r.title || r.url,
      url: r.url,
      content: (r.content || "").slice(0, 1200)
    }));

  return { sources, answer: payload?.answer || "" };
}
