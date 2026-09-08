import { tavilySearch } from "./tavily.js";
import { callMistral, textOf, extractJson } from "./mistral.js";
import { formatPrompt, refitPrompt, refitOnePrompt } from "./prompts.js";
import { searchCacheKey, searchCacheGet, searchCachePut } from "./searchCache.js";
import {
  lengthIssues, describeIssue, distanceOutside,
  setFieldValue, stripWrapping
} from "./lengths.js";
import { MAX_PART_LENGTH } from "./settings.js";

/* Budgeted against the length rules rather than guessed at. At the
   defaults the JSON body alone is a 200-char title, five 150-char
   bullets and a 2,000-char description — roughly 800 tokens before
   specs, compatibility and warnings. A ceiling too low truncates the
   JSON mid-string and surfaces as "the listing came back unreadable",
   which looks like a model fault and isn't one. */
const MAX_TOKENS = 2600;

/* ---------- part number parsing ---------- */

const stripMarker = s => s.trim().replace(/^(?:[-*•]|\d{1,3}[.)])\s+/, "").trim();

export function parsePartNumbers(raw) {
  return String(raw || "")
    .split(/[\n,;]+/)
    .map(stripMarker)
    .filter(Boolean)
    .filter(s => s.length <= MAX_PART_LENGTH)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 60);
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

/* ---------- length repair ---------- */

async function refitCall(d, sources, { settings, signal, onNote }) {
  const issues = lengthIssues(d, settings);
  if (!issues.length) return d;

  const { payload } = await callMistral({
    messages: [{ role: "user", content: refitPrompt(d, issues, sources) }],
    temperature: 0.3,
    max_tokens: MAX_TOKENS,
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
    if (!tavilyKey) throw new Error("No Tavily key configured. Add one in Settings.");
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

  const { payload, model, apiKey } = await callMistral({
    messages: [{ role: "user", content: formatPrompt(part, opts, sources, settings) }],
    temperature: 0.3,
    max_tokens: MAX_TOKENS,
    response_format: { type: "json_object" }
  }, { signal, onNote: t => onNote({ text: t }), settings });

  onNote({ tokens: payload?.usage?.total_tokens, model, apiKey });

  let data = extractJson(textOf(payload).trim());
  if (!data) throw new Error("The listing came back unreadable. Try running this part number again.");

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

  return {
    part_number: s(d.part_number) || part,
    brand: s(d.brand),
    model: s(d.model),
    product_type: s(d.product_type),
    identified: d.identified !== false,
    confidence: ["high", "medium", "low"].includes(d.confidence) ? d.confidence : "medium",
    title: s(d.title),
    bullets: bullets.slice(0, 5),
    description: s(d.description),
    specs: arr(d.specs)
      .filter(x => x && (x.label || x.value))
      .map(x => ({ label: s(x.label), value: s(x.value) }))
      .slice(0, 14),
    compatibility: arr(d.compatibility).map(s).filter(Boolean),
    alternate_part_numbers: arr(d.alternate_part_numbers).map(s).filter(Boolean),
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
    || d.warnings.length > 0
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
