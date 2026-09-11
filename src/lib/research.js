import { tavilySearch } from "./tavily.js";
import { callMistral, textOf, extractJson } from "./mistral.js";
import { formatPrompt, refitPrompt, refitOnePrompt } from "./prompts.js";
import { searchCacheKey, searchCacheGet, searchCachePut } from "./searchCache.js";
import {
  lengthIssues, describeIssue, distanceOutside,
  setFieldValue, stripWrapping, liveWarnings
} from "./lengths.js";
import { MAX_PART_LENGTH } from "./settings.js";

/* Budgeted against the length rules rather than guessed at. At the
   defaults the JSON body alone is a 200-char title, five 150-char
   bullets and a 2,000-char description — roughly 800 tokens before
   specs, compatibility and warnings. A ceiling too low truncates the
   JSON mid-string and surfaces as "the listing came back unreadable",
   which looks like a model fault and isn't one.

   Settings allow the length maxes to go well above the defaults
   (title/bullet up to 500, description up to 6000), so the budget is
   derived from the configured maxes rather than fixed, with the old
   2600 as a floor for the default configuration. */
function maxTokensFor(settings) {
  const charsBudget =
    (settings.titleMax || 200) +
    5 * (settings.bulletMax || 150) +
    (settings.descMax || 2000) +
    600; // specs/compat/alt-parts/warnings/JSON overhead
  return Math.max(2600, Math.ceil(charsBudget / 3.2)); // ~3.2 chars/token, generous
}

/* ---------- part number parsing ---------- */

const stripMarker = s => s.trim().replace(/^(?:[-*•]|\d{1,3}[.)])\s+/, "").trim();

/* Dedupe is case-insensitive (matches the queue-wide dedupe and the
   search-cache key, both of which uppercase before comparing) but the
   first-seen casing is kept, since that's what the operator typed. */
export function parsePartNumbers(raw) {
  const seen = new Set();
  const out = [];
  for (let s of String(raw || "").split(/[\n,;]+/).map(stripMarker)) {
    if (!s || s.length > MAX_PART_LENGTH) continue;
    const key = s.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= 60) break;
  }
  return out;
}

/* A single line over ~40 characters is essentially never a real part
   number — it's almost always a paragraph that landed on one line, and
   sending that into a prompt is what trips a 413. Counted separately so
   the caller can warn rather than silently losing the paste. */
export function oversizedPartCount(raw) {
  return String(raw || "")
    .split(/[\n,;]+/)
    .map(stripMarker)
    .filter(Boolean)
    .filter(s => s.length > MAX_PART_LENGTH)
    .length;
}

/* ---------- defensive coercion ---------- */

/* Mistral's JSON mode is reliable about types almost always, but "almost
   always" plus 60-part batches means the rare miss (a string instead of
   an array, etc.) needs to not crash the pipeline. Applied right after
   parsing, before anything else touches the object, so every downstream
   consumer (lengthIssues, refit, normalise) can trust the shape. */
function coerceShape(d) {
  if (!d || typeof d !== "object") return {};
  const out = { ...d };
  if (!Array.isArray(out.bullets)) out.bullets = [];
  out.bullets = out.bullets.map(b => (typeof b === "string" ? b : "")).slice(0, 5);
  while (out.bullets.length < 5) out.bullets.push("");
  if (!Array.isArray(out.warnings)) out.warnings = out.warnings ? [String(out.warnings)] : [];
  if (!Array.isArray(out.specs)) out.specs = [];
  if (!Array.isArray(out.compatibility)) out.compatibility = [];
  if (!Array.isArray(out.alternate_part_numbers)) out.alternate_part_numbers = [];
  out.title = typeof out.title === "string" ? out.title : "";
  out.description = typeof out.description === "string" ? out.description : "";
  return out;
}

/* ---------- length repair ---------- */

async function refitCall(d, sources, { settings, signal, onNote }) {
  const issues = lengthIssues(d, settings);
  if (!issues.length) return d;

  const { payload } = await callMistral({
    messages: [{ role: "user", content: refitPrompt(d, issues, sources) }],
    temperature: 0.3,
    max_tokens: maxTokensFor(settings),
    response_format: { type: "json_object" }
  }, { signal, onNote, settings });

  const fixed = extractJson(textOf(payload).trim());
  if (!fixed) return d;

  /* Only accept a rewrite that actually moved the field closer to its
     range. A pass that overshoots in the other direction, or comes back
     worse, is discarded rather than allowed to make things worse than
     where it started. */
  const next = { ...d, bullets: [...(d.bullets || [])] };
  for (const i of issues) {
    const proposed = typeof fixed[i.field] === "string" ? stripWrapping(fixed[i.field]) : null;
    if (!proposed) continue;
    const before = distanceOutside(i.n, i.min, i.max);
    const after = distanceOutside(proposed.trim().length, i.min, i.max);
    if (after < before) setFieldValue(next, i.field, proposed.trim());
  }
  return next;
}

async function refitLengths(data, sources, { settings, signal, onNote }) {
  for (let pass = 0; pass < settings.refitPasses; pass++) {
    const issues = lengthIssues(data, settings);
    if (!issues.length) return data;

    onNote({ text: `Fixing length on ${issues.length} field${issues.length === 1 ? "" : "s"} (pass ${pass + 1} of ${settings.refitPasses}): ${issues.map(i => i.label.toLowerCase()).join(", ")}.` });

    const before = JSON.stringify([data.title, data.bullets, data.description]);
    try {
      data = await refitCall(data, sources, { settings, signal, onNote: t => onNote({ text: t }) });
    } catch (e) {
      if (e.name === "AbortError") throw e;
      // A fatal error (every Mistral key exhausted, no key configured)
      // means every remaining item in the batch would fail identically
      // too — swallowing it here let the batch grind through the full
      // retry ladder on each one instead of stopping. Let the caller
      // (App.jsx's batch loop) see it and halt.
      if (e._fatal) throw e;
      onNote({ text: `Couldn't run the length fix (${e.message}). Keeping what's there and flagging it.` });
      break;
    }

    // A pass that changed nothing will change nothing next time either.
    if (JSON.stringify([data.title, data.bullets, data.description]) === before) break;
  }

  const left = lengthIssues(data, settings);
  if (left.length) {
    data.warnings = [...(data.warnings || []), ...left.map(describeIssue)];
    onNote({ text: `${left.length} field${left.length === 1 ? " is" : "s are"} still outside the required range — flagged for review.` });
  }
  return data;
}

/** Single-field rewrite for the editor's "Fit to range" button. */
export async function refitOne(field, value, min, max, sources, settings) {
  const { payload } = await callMistral({
    messages: [{ role: "user", content: refitOnePrompt(field, value, min, max, sources) }],
    temperature: 0.3,
    max_tokens: 2000
  }, { settings });
  return stripWrapping(textOf(payload));
}

/* ---------- the run ---------- */

export async function research(part, opts, onNote, signal, { settings, forceFresh = false }) {
  const tavilyKey = (settings.tavilyKey || "").trim();
  const maxResults = settings.tavilyResults || 6;
  const key = searchCacheKey(part, opts, maxResults);
  const query = `${part}${opts.brand ? " " + opts.brand : ""} specifications datasheet replacement part`;

  let sources;
  let fromCache = false;
  const hit = forceFresh ? null : searchCacheGet(key, settings);

  if (hit) {
    sources = hit.sources;
    fromCache = true;
    onNote({ text: `Reusing the search saved on ${new Date(hit.at).toLocaleDateString()} — no Tavily credit spent.` });
  } else {
    if (!tavilyKey) { const e = new Error("No Tavily key configured. Add one in Settings."); e._fatal = true; throw e; }
    onNote({ text: "Searching for " + part });
    ({ sources } = await tavilySearch(query, tavilyKey, maxResults, signal));
    onNote({ spentCredit: true });
    searchCachePut(key, query, sources, settings);
  }

  if (!sources.length) {
    onNote({ text: "No search results came back for this one — treat the result as unverified." });
  } else {
    onNote({ queries: [query] });
    onNote({ text: `Read ${sources.length} source${sources.length === 1 ? "" : "s"}. Writing the listing.` });
  }

  const maxTokens = maxTokensFor(settings);
  const { payload, model, apiKey } = await callMistral({
    messages: [{ role: "user", content: formatPrompt(part, opts, sources, settings) }],
    temperature: 0.3,
    max_tokens: maxTokens,
    response_format: { type: "json_object" }
  }, { signal, onNote: t => onNote({ text: t }), settings });

  onNote({ tokens: payload?.usage?.total_tokens, model, apiKey });

  const finishReason = payload?.choices?.[0]?.finish_reason;
  let data = coerceShape(extractJson(textOf(payload).trim()));
  if (!Object.keys(data).length) throw new Error("The listing came back unreadable. Try running this part number again.");
  if (finishReason === "length") {
    data.warnings = [...(data.warnings || []), "The generated reply was cut off before it finished — some fields may be incomplete or missing. Rerun this part number."];
  }

  // Measure every length rule and repair anything outside its range
  // before the listing is ever shown as finished.
  data = await refitLengths(data, sources, { settings, signal, onNote });

  if (!sources.length) {
    data.warnings = [...(data.warnings || []), "No search results were found for this part number — everything above is unverified."];
  }

  data._sources = sources;
  data._queries = [query];
  data._fromCache = fromCache;
  return data;
}

/* ---------- shaping ---------- */

export function normalise(d, part) {
  const s = v => (typeof v === "string" ? v.trim() : "");
  const arr = v => (Array.isArray(v) ? v : []);

  const bullets = arr(d.bullets).map(s).filter(Boolean);
  while (bullets.length < 5) bullets.push("");

  /* A trimmed snippet is kept alongside the URL so the editor's "Fit to
     range" button can lengthen a hand-edited field from the same sourced
     material the listing was written from, rather than from nothing.
     Trimmed hard because this goes into localStorage for every item. */
  const sources = arr(d._sources)
    .map(x => ({ title: s(x.title), url: s(x.url), content: s(x.content).slice(0, 700) }))
    .filter(x => x.url);

  const modelPn = s(d.part_number);
  const alternates = arr(d.alternate_part_numbers).map(s).filter(Boolean);
  // The operator's typed part number is authoritative — a model that
  // returns a different value (a normalised form, a typo "fix", or a
  // hallucinated one) never silently overwrites what was actually
  // searched for. If the model's version differs, keep it visible as
  // an alternate rather than losing it.
  if (modelPn && modelPn.toUpperCase() !== String(part).trim().toUpperCase() && !alternates.includes(modelPn)) {
    alternates.push(modelPn);
  }

  return {
    part_number: part,
    brand: s(d.brand),
    model: s(d.model),
    product_type: s(d.product_type),
    // Default toward review, not away from it: an explicit `true` is
    // required to call a part identified; anything missing, malformed
    // or falsy is treated as not identified.
    identified: d.identified === true,
    confidence: ["high", "medium", "low"].includes(d.confidence) ? d.confidence : "low",
    title: s(d.title),
    bullets: bullets.slice(0, 5),
    description: s(d.description),
    specs: arr(d.specs)
      .filter(x => x && (x.label || x.value))
      .map(x => ({ label: s(x.label), value: s(x.value) }))
      .slice(0, 14),
    compatibility: arr(d.compatibility).map(s).filter(Boolean),
    alternate_part_numbers: alternates,
    warnings: arr(d.warnings).map(s).filter(Boolean),
    sources,
    queries: arr(d._queries),
    fromCache: d._fromCache === true,
    searchPerformed: sources.length > 0
  };
}

export function needsReview(d, settings) {
  return !d.identified
    || d.confidence === "low"
    || liveWarnings(d, settings).length > 0
    || lengthIssues(d, settings).length > 0
    || d.sources.length < 2;
}

/* Source URLs arrive from a third-party search API and get written into
   an href. Anything that isn't plain http(s) is dropped rather than
   rendered. */
export function safeUrl(u) {
  try {
    const p = new URL(String(u), window.location.href);
    return (p.protocol === "http:" || p.protocol === "https:") ? p.href : "";
  } catch {
    return "";
  }
}
