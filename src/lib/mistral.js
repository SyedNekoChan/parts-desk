import { ENDPOINTS, authHeaders, withTimeout, isTimeout, readJsonBody, REQUEST_TIMEOUT_MS } from "./api.js";
import { FORMAT_MODELS } from "./settings.js";

export function readableError(status, payload) {
  const msg = payload?.message || payload?.error?.message || "";
  if (status === 401) return "That API key isn't valid. Check it in Settings, or make a new one at console.mistral.ai/api-keys.";
  if (status === 403) return "The key was refused for this request. " + msg;
  if (status === 429) return "Free tier limit reached — either the per-minute cap or the monthly token allowance. This costs nothing; a Free-tier key has no payment method to charge, so it just waits or, if you've added a backup key, switches to it.";
  if (status === 503 || status === 500) return "Mistral's servers are busy. Trying again in a moment usually clears it.";
  if (status === 404) return "That model name wasn't found. Pick another one in Settings.";
  if (status === 413) return `The request was too large${msg ? ` — Mistral's exact wording: "${msg}"` : ", with no further detail in the response"}. The app tries an alternate model automatically before giving up.`;
  return `API error ${status}. ${msg}`;
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => {
    clearTimeout(t);
    reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
  }, { once: true });
});

/* Mistral, like most OpenAI-style APIs, can send Retry-After on a 429.
   Its rate-limit message wording isn't independently confirmed, so this
   doesn't try to parse a recommended wait out of the message text —
   just the header, then a standard backoff. Capped so a single huge
   header value can't stall a batch for hours. */
const MAX_RETRY_WAIT_MS = 90000;

function retryDelayMs(res) {
  const h = res?.headers?.get?.("retry-after");
  if (h) {
    const n = parseFloat(h);
    if (!Number.isNaN(n)) return Math.min(MAX_RETRY_WAIT_MS, Math.ceil(n * 1000));
  }
  return 0;
}

async function callOnce(model, body, { signal, onNote, apiKey, settings }) {
  const attempts = Math.max(0, settings.retries) + 1;
  let lastErr = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    let res;
    try {
      res = await fetch(ENDPOINTS.mistralChat, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders(apiKey) },
        body: JSON.stringify({ model, ...body }),
        signal: withTimeout(signal)
      });
    } catch (e) {
      if (isTimeout(e)) throw new Error(`Mistral didn't answer within ${REQUEST_TIMEOUT_MS / 1000} seconds. Try this part number again.`);
      if (e.name === "AbortError") throw e;
      throw new Error("Couldn't reach Mistral. Check your connection and try again. If every request fails this way, the browser may be blocking it (a CORS restriction) rather than Mistral being down.");
    }

    const payload = await readJsonBody(res);
    if (res.ok) return payload;

    // 404 means the model itself is gone — retiring, renamed, or a
    // lineup change — not something a retry will fix. 401/403 are
    // key problems, not rate problems — no retry helps either.
    // 429/503/500 are worth retrying with backoff.
    const quotaExceeded = res.status === 429;
    const retryable = quotaExceeded || res.status === 503 || res.status === 500;
    const authFailure = res.status === 401 || res.status === 403;

    lastErr = new Error(readableError(res.status, payload));
    lastErr._status = res.status;
    lastErr._daily = false;
    lastErr._auth = authFailure;
    lastErr._model = model;
    lastErr._raw = payload; // shown verbatim in the UI so a misdiagnosis on our end is visible

    if (!retryable || attempt === attempts - 1) {
      lastErr._daily = quotaExceeded;
      throw lastErr;
    }

    const wait = retryDelayMs(res) || Math.min(MAX_RETRY_WAIT_MS, 4000 * Math.pow(2, attempt));
    const mins = Math.round(wait / 60000);
    const label = wait >= 60000 ? `${mins} minute${mins === 1 ? "" : "s"}` : `${Math.round(wait / 1000)}s`;
    onNote?.(`Rate limited. Waiting ${label}, then carrying on.`);
    await sleep(wait, signal);
  }

  throw lastErr;
}

/* Try the operator's chosen model first, then whichever one last worked
   in this tab as a fallback, then the remaining alternates, and only
   fail once every option is exhausted.

   The preferred model goes first (not lastWorkingModel) so a model
   change in Settings takes effect on the very next call rather than
   being masked by whatever last succeeded. */
let lastWorkingModel = null;
export const getLastWorkingModel = () => lastWorkingModel;
export const resetModelMemory = () => { lastWorkingModel = null; };

async function callWithModelFallback(preferred, body, ctx) {
  const candidates = [...new Set([preferred, lastWorkingModel, ...FORMAT_MODELS].filter(Boolean))];
  const tried = [];
  let lastErr = null;

  for (const model of candidates) {
    try {
      const payload = await callOnce(model, body, { ...ctx, model });
      if (model !== preferred) ctx.onNote?.(`Using ${model} for this one — ${tried[0] || preferred} wasn't available just now.`);
      lastWorkingModel = model;
      return { payload, model };
    } catch (e) {
      if (e.name === "AbortError") throw e;
      tried.push(model);
      if (e._status === 404 || e._status === 413 || e._daily) { lastErr = e; continue; }
      throw e;
    }
  }

  const daily = lastErr?._daily;
  const finalErr = new Error(
    daily
      ? `Both ${tried.join(" and ")} have hit a rate or quota limit on this key that didn't clear after retrying.`
      : lastErr?._status === 413
        ? `Both ${tried.join(" and ")} rejected this request as too large (413). See the raw response below — Mistral's exact wording, not our guess at what it means.`
        : `None of these models (${tried.join(", ")}) are answering for this key right now. Open Settings and use "Check available models" to see what your key can actually reach — free-tier lineups change over time on every provider.`
  );
  finalErr._status = lastErr?._status;
  finalErr._daily = daily;
  finalErr._raw = lastErr?._raw;
  finalErr._model = lastErr?._model;
  throw finalErr;
}

/* Every configured key is its own free-tier organisation with its own
   allowance. Rather than sit through a long wait on one key, try the
   next configured key first. Only a persistent rate/quota failure
   (after every model has been tried on this key) triggers rotation: a
   bad key or a missing model would fail identically on every key, so
   there's no point trying them all. An auth failure (401/403) is not
   retried across models — it's thrown immediately as a fatal error so
   the caller can stop the batch instead of burning through the model
   fallback ladder for a key that will never work. */
let activeKeyIndex = 0;
export const resetKeyRotation = () => { activeKeyIndex = 0; };

export async function callMistral(body, { signal, onNote, settings }) {
  const keys = (settings.apiKeys || []).filter(Boolean);
  if (!keys.length) {
    const err = new Error("No API key configured. Add one in Settings.");
    err._fatal = true;
    throw err;
  }

  const start = activeKeyIndex % keys.length;
  const order = keys.map((_, i) => (start + i) % keys.length);
  let lastErr = null;

  for (const idx of order) {
    try {
      const result = await callWithModelFallback(settings.formatModel, body, {
        signal, onNote, apiKey: keys[idx], settings
      });
      activeKeyIndex = idx;
      return { ...result, apiKey: keys[idx], keyIndex: idx };
    } catch (e) {
      if (e.name === "AbortError") throw e;
      if (e._auth) { e._fatal = true; throw e; }
      if (!e._daily) throw e;
      lastErr = e;
      if (keys.length > 1) onNote?.(`Key ${idx + 1} of ${keys.length} is rate- or quota-limited right now — switching to the next one instead of waiting.`);
    }
  }

  const exhausted = new Error(
    keys.length > 1
      ? `All ${keys.length} configured keys are rate- or quota-limited right now. Try again shortly, or add another free Mistral account's key in Settings.`
      : `${lastErr?.message || "A rate or quota limit has been reached."} Add a second free Mistral account's key in Settings to keep going instead of waiting — Mistral's allowance is per account, so a second key gets its own fresh one.`
  );
  exhausted._fatal = true; // every configured key is exhausted — no point continuing the batch
  throw exhausted;
}

/** Diagnostic: asks Mistral directly which models a key can call. */
export async function listAvailableModels(apiKey) {
  const res = await fetch(ENDPOINTS.mistralModels, {
    headers: authHeaders(apiKey),
    signal: withTimeout(null, 20000)
  });
  const payload = await readJsonBody(res);
  if (!res.ok) throw new Error(readableError(res.status, payload));
  return (payload?.data || []).map(m => m.id).filter(Boolean).sort();
}

export function textOf(payload) {
  return payload?.choices?.[0]?.message?.content || "";
}

/* json_object mode makes clean JSON the norm, but a truncated or fenced
   reply still turns up occasionally, so parse defensively.

   A refit reply only contains the specific fields that were asked for
   (e.g. just "bullet2"), so it won't have a "title" or "bullets" key.
   When exactly one brace-object candidate is found, it's accepted on
   its own — there's nothing else it could be. The title/bullets check
   is only a tiebreaker when scanning found more than one candidate. */
export function extractJson(text) {
  if (!text) return null;

  try {
    const direct = JSON.parse(text);
    if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct;
  } catch { /* fall through to scanning */ }

  const candidates = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) { candidates.push(text.slice(i, j + 1)); i = j; break; }
      }
    }
  }

  if (candidates.length === 1) {
    try {
      const o = JSON.parse(candidates[0]);
      if (o && typeof o === "object" && !Array.isArray(o)) return o;
    } catch { /* not valid JSON after all */ }
    return null;
  }

  for (let k = candidates.length - 1; k >= 0; k--) {
    try {
      const o = JSON.parse(candidates[k]);
      if (o && typeof o === "object" && ("title" in o || "bullets" in o)) return o;
    } catch { /* try the next candidate */ }
  }

  return null;
}
