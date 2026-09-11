/* ============================================================
   Parts Desk — optional API proxy

   The frontend does not need this. On GitHub Pages it calls Mistral and
   Tavily straight from the browser using whichever key the operator
   entered, and each person's free-tier allowance stays their own.

   Run this only if you hit one of these:

     1. CORS. A browser refuses the direct call to a provider. A proxy
        is the standard fix, because a server-to-server request isn't
        subject to the browser's origin rules.
     2. Shared network policy. Your office blocks the provider domains
        but allows your own host.
     3. Local development against mock data, so you can work on the UI
        without spending a single search credit.

   ---------------------------------------------------------------
   THE ONE RULE THIS FILE FOLLOWS

   No API keys live here. Not in code, not in .env, not in memory
   between requests. Every request carries the caller's own key in an
   x-provider-key header and that key is used for exactly one upstream
   call and then forgotten.

   That is not an aesthetic preference. A shared server-side key would
   mean one account absorbing everyone's usage, one free tier exhausted
   by the whole team at once, and one person's name on the upgrade
   prompt when it runs out. Per-user keys keep each person inside their
   own free allowance, which is the only arrangement that stays free.

   The same rule means this server is uninteresting to attack: there is
   no stored credential to steal. Keep it that way.
   ---------------------------------------------------------------

   Run:      npm run server        (defaults to port 8787)
   Mock:     MOCK=1 npm run server (no upstream calls, no credits spent)
   Frontend: VITE_API_BASE=http://localhost:8787 npm run build
   ============================================================ */

import express from "express";
import cors from "cors";

const PORT = process.env.PORT || 8787;
const MOCK = process.env.MOCK === "1";

/* Which browser origins may call this proxy. Defaults are the Vite dev
   server; add your GitHub Pages URL when you deploy:
     ALLOWED_ORIGINS="https://yourname.github.io" npm run server        */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  "http://localhost:5173,http://127.0.0.1:5173")
  .split(",").map(s => s.trim()).filter(Boolean);

const UPSTREAM = {
  mistralChat: "https://api.mistral.ai/v1/chat/completions",
  mistralModels: "https://api.mistral.ai/v1/models",
  tavilySearch: "https://api.tavily.com/search"
};

const REQUEST_TIMEOUT_MS = 90000;
const MAX_BODY = "1mb";

const app = express();

/* A disallowed origin is a routine, expected occurrence (a stray
   browser tab, a misconfigured deploy, someone probing) — not a server
   fault. cors() signals this by having its origin callback receive an
   Error; left to propagate, that lands in Express's generic error
   handler and comes back as a 500, which looks like the proxy itself
   is broken. This wrapper recognises specifically the CORS-rejection
   error (tagged below) and answers 403 directly, before it can reach
   the generic handler. Any other, unrelated error still falls through
   to that handler unchanged. */
function corsError(origin) {
  const err = new Error(`Origin ${origin} is not in ALLOWED_ORIGINS.`);
  err._corsRejected = true;
  return err;
}

const corsMiddleware = cors({
  origin(origin, cb) {
    // Same-origin and non-browser callers (curl, health checks) send no
    // Origin header at all; those are fine.
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(corsError(origin));
  },
  allowedHeaders: ["content-type", "x-provider-key"],
  // retry-after is forwarded from the upstream provider (see forward()
  // below), but without this the browser's fetch() strips it from what
  // client JS can read, silently discarding the wait guidance a 429
  // response carries.
  exposedHeaders: ["retry-after"],
  methods: ["GET", "POST", "OPTIONS"],
  maxAge: 86400
});

app.use((req, res, next) => {
  corsMiddleware(req, res, err => {
    if (!err) return next();
    if (err._corsRejected) {
      return res.status(403).json({ message: err.message });
    }
    next(err);
  });
});

app.use(express.json({ limit: MAX_BODY }));

/* Logging deliberately records the route and the outcome, never the
   headers and never the body. Bodies contain part numbers and prompt
   text; headers contain the caller's key. Neither belongs in a log
   file that will outlive the request. */
app.use((req, res, next) => {
  const started = Date.now();
  res.on("finish", () => {
    console.log(`${req.method} ${req.path} → ${res.statusCode} (${Date.now() - started}ms)`);
  });
  next();
});

function providerKey(req, res) {
  const key = req.get("x-provider-key");
  if (!key) {
    res.status(401).json({
      message: "No key was sent. This proxy holds no credentials of its own — each request carries the caller's own API key in an x-provider-key header."
    });
    return null;
  }
  return key;
}

/** One upstream call, with a timeout and the caller's key attached.
 *  Also relays the upstream's retry-after header (if any) back up to
 *  the route, so a 429 from Mistral or Tavily can tell the browser
 *  client how long to wait instead of that guidance being silently
 *  dropped at the proxy boundary. */
async function forward(url, { method = "POST", key, body }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const upstream = await fetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + key
      },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
      signal: controller.signal
    });

    const retryAfter = upstream.headers.get("retry-after");
    const text = await upstream.text();
    let payload;
    try { payload = JSON.parse(text); }
    catch { payload = { message: text.slice(0, 500) }; }

    return { status: upstream.status, payload, retryAfter };
  } catch (e) {
    if (e.name === "AbortError") {
      return {
        status: 504,
        payload: { message: `The provider didn't answer within ${REQUEST_TIMEOUT_MS / 1000} seconds.` },
        retryAfter: null
      };
    }
    return { status: 502, payload: { message: `Couldn't reach the provider: ${e.message}` }, retryAfter: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Sets retry-after on the outgoing response when the upstream sent
 *  one, then sends the status/payload — one place for every route to
 *  go through so none of them can forget the header. */
function relay(res, { status, payload, retryAfter }) {
  if (retryAfter) res.set("retry-after", retryAfter);
  res.status(status).json(payload);
}

/* ---------- mock mode ----------
   Enough shape to develop the whole UI against — including the length
   rules, which are the interesting part — without spending a credit or
   needing a key. The copy is obviously fake so it can never be mistaken
   for a real listing that reached production. */

function mockSources(query) {
  return [1, 2, 3].map(n => ({
    title: `Mock source ${n} for ${query}`.slice(0, 90),
    url: `https://example.invalid/mock/${n}`,
    content: `Placeholder specification text for development. This stands in for a real datasheet excerpt and is long enough for the writing step to have something to work with. Source ${n}.`
  }));
}

function mockListing(prompt) {
  const part = (/Part number: (.+)/.exec(prompt)?.[1] || "MOCK-PART").trim();
  const pad = (base, n) => base.repeat(Math.ceil(n / base.length)).slice(0, n);

  return {
    part_number: part,
    brand: "MockBrand",
    model: "Development Sample",
    product_type: "Placeholder component",
    identified: true,
    confidence: "medium",
    title: pad(`MockBrand Development Sample ${part} placeholder listing for local UI work `, 175),
    bullets: [1, 2, 3, 4, 5].map(n =>
      pad(`Mock bullet ${n} standing in for real sourced copy during development so the counters have something to measure. `, 135)),
    description: pad(`This is mock description text for ${part}, generated by the local proxy in MOCK mode so the interface can be developed without spending search credits. It is deliberately obvious placeholder copy. `, 1750),
    specs: [{ label: "Mock spec", value: "Development only" }],
    compatibility: ["Mock system A", "Mock system B"],
    alternate_part_numbers: ["MOCK-ALT-1"],
    warnings: ["This listing came from the proxy's mock mode and contains no real product data."]
  };
}

/* ---------- routes ---------- */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    mock: MOCK,
    holdsKeys: false,
    allowedOrigins: ALLOWED_ORIGINS
  });
});

app.post("/api/tavily/search", async (req, res) => {
  const key = MOCK ? "mock" : providerKey(req, res);
  if (!key) return;

  const { query, max_results = 6, search_depth = "basic" } = req.body || {};
  if (!query || typeof query !== "string") {
    return res.status(400).json({ message: "A 'query' string is required." });
  }

  if (MOCK) {
    return res.json({ results: mockSources(query).slice(0, max_results), answer: "" });
  }

  const result = await forward(UPSTREAM.tavilySearch, {
    key,
    body: { query, max_results, search_depth }
  });
  relay(res, result);
});

app.post("/api/mistral/chat", async (req, res) => {
  const key = MOCK ? "mock" : providerKey(req, res);
  if (!key) return;

  const { model, messages, temperature, max_tokens, response_format } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ message: "A non-empty 'messages' array is required." });
  }

  if (MOCK) {
    const prompt = messages.map(m => m.content).join("\n");
    // A repair call names the fields it wants back; anything else is a
    // fresh listing.
    const isRefit = prompt.includes("You are fixing the length");
    const content = JSON.stringify(isRefit ? {} : mockListing(prompt));
    return res.json({
      choices: [{ message: { content } }],
      usage: { total_tokens: 1234 },
      model: model || "mock-model"
    });
  }

  const result = await forward(UPSTREAM.mistralChat, {
    key,
    body: { model, messages, temperature, max_tokens, response_format }
  });
  relay(res, result);
});

app.get("/api/mistral/models", async (req, res) => {
  const key = MOCK ? "mock" : providerKey(req, res);
  if (!key) return;

  if (MOCK) {
    return res.json({ data: [{ id: "mistral-small-latest" }, { id: "open-mistral-nemo" }] });
  }

  const result = await forward(UPSTREAM.mistralModels, { key, method: "GET" });
  relay(res, result);
});

app.use((req, res) => {
  res.status(404).json({ message: `No route for ${req.method} ${req.path}.` });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Unhandled:", err.message);
  res.status(500).json({ message: "The proxy hit an unexpected error. Check its console." });
});

app.listen(PORT, () => {
  console.log(`Parts Desk proxy on http://localhost:${PORT}`);
  console.log(`  mode:            ${MOCK ? "MOCK (no upstream calls, no credits spent)" : "live"}`);
  console.log(`  stored keys:     none — every request carries the caller's own`);
  console.log(`  allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
});

export default app;
