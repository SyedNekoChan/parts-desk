import {
  lengthIssues, lengthTarget, distanceOutside, stripWrapping, rangeState,
  fieldValue, setFieldValue, describeIssue, liveWarnings
} from "../src/lib/lengths.js";
import { normaliseLengthSettings, DEFAULTS } from "../src/lib/settings.js";
import {
  searchCacheKey, searchCacheGet, searchCachePut, searchCacheCount, searchCacheClear
} from "../src/lib/searchCache.js";
import { parsePartNumbers, oversizedPartCount, normalise, needsReview } from "../src/lib/research.js";
import { buildCsv } from "../src/lib/csv.js";
import { extractJson } from "../src/lib/mistral.js";
import { mergeRemoteItems, isHeartbeatFresh, makeItemId } from "../src/lib/queueSync.js";

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  if (!ok) console.log("FAIL", label, "\n  got ", JSON.stringify(got), "\n  want", JSON.stringify(want));
};
const S = n => "x".repeat(n);
const cfg = { ...DEFAULTS };
const good = { title: S(175), bullets: [S(130), S(130), S(130), S(130), S(130)], description: S(1750) };

t("in-range listing is clean", lengthIssues(good, cfg).length, 0);
t("title at 200 is fine", lengthIssues({ ...good, title: S(200) }, cfg).length, 0);
t("title at 150 is fine", lengthIssues({ ...good, title: S(150) }, cfg).length, 0);
t("title 201 over by one", lengthIssues({ ...good, title: S(201) }, cfg)[0].delta, 1);
t("title 149 short by one", lengthIssues({ ...good, title: S(149) }, cfg)[0].delta, 1);
t("bad bullets flagged individually",
  lengthIssues({ ...good, bullets: [S(130), S(151), S(119), S(130), S(130)] }, cfg).map(i => i.field),
  ["bullet1", "bullet2"]);
t("desc 2001 over", lengthIssues({ ...good, description: S(2001) }, cfg)[0].field, "description");
t("desc 1499 short by one", lengthIssues({ ...good, description: S(1499) }, cfg)[0].delta, 1);
t("empty bullet short by the whole minimum",
  lengthIssues({ ...good, bullets: [S(130), "", S(130), S(130), S(130)] }, cfg)[0].delta, 120);
t("surrounding whitespace not counted",
  lengthIssues({ ...good, title: "  " + S(150) + "  " }, cfg).length, 0);

t("target lands inside the range", lengthTarget(150, 200), 185);
t("distance zero inside range", distanceOutside(160, 150, 200), 0);
t("distance over", distanceOutside(220, 150, 200), 20);

t("cacheDays 0 (cache off) survives", normaliseLengthSettings({ ...DEFAULTS, cacheDays: 0 }).cacheDays, 0);
t("cacheDays '0' string survives", normaliseLengthSettings({ ...DEFAULTS, cacheDays: "0" }).cacheDays, 0);
t("refitPasses 0 survives", normaliseLengthSettings({ ...DEFAULTS, refitPasses: 0 }).refitPasses, 0);
t("titleMin 0 survives", normaliseLengthSettings({ ...DEFAULTS, titleMin: 0, titleMax: 200 }).titleMin, 0);
t("negative cacheDays falls back to default", normaliseLengthSettings({ ...DEFAULTS, cacheDays: -5 }).cacheDays, DEFAULTS.cacheDays);
t("missing titleMax falls back to default", normaliseLengthSettings({ ...DEFAULTS, titleMax: undefined }).titleMax, DEFAULTS.titleMax);
t("min above max is clamped down to max", normaliseLengthSettings({ ...DEFAULTS, titleMin: 999, titleMax: 200 }).titleMin, 200);

/* ---------- empty numeric fields fall back to default, not 0 (#6) ---------- */
t("empty-string cacheDays falls back to default, not 0",
  normaliseLengthSettings({ ...DEFAULTS, cacheDays: "" }).cacheDays, DEFAULTS.cacheDays);
t("empty-string refitPasses falls back to default, not 0",
  normaliseLengthSettings({ ...DEFAULTS, refitPasses: "" }).refitPasses, DEFAULTS.refitPasses);
t("empty-string titleMin falls back to default, not 0",
  normaliseLengthSettings({ ...DEFAULTS, titleMin: "" }).titleMin, DEFAULTS.titleMin);
t("null cacheDays falls back to default, not 0",
  normaliseLengthSettings({ ...DEFAULTS, cacheDays: null }).cacheDays, DEFAULTS.cacheDays);
t("explicit numeric 0 for cacheDays is still honoured (cache off)",
  normaliseLengthSettings({ ...DEFAULTS, cacheDays: 0 }).cacheDays, 0);
t("explicit string '0' for refitPasses is still honoured",
  normaliseLengthSettings({ ...DEFAULTS, refitPasses: "0" }).refitPasses, 0);

t("case-insensitive dedupe keeps first-seen casing",
  parsePartNumbers("abc\nABC\nAbC"), ["abc"]);
t("distinct parts with different case both kept once",
  parsePartNumbers("abc\ndef\nABC\nDEF"), ["abc", "def"]);
t("dedupe with markers stripped first",
  parsePartNumbers("1. abc\n2) ABC"), ["abc"]);

t("part_number always matches operator input regardless of model output",
  normalise({ part_number: "MODEL-SAYS-THIS" }, "operator-typed").part_number, "operator-typed");
t("differing model part number recorded as an alternate",
  normalise({ part_number: "ALT-123" }, "abc").alternate_part_numbers, ["ALT-123"]);
t("matching model part number not duplicated as alternate",
  normalise({ part_number: "abc" }, "abc").alternate_part_numbers, []);
t("identified defaults false when missing", normalise({}, "p").identified, false);
t("identified defaults false when non-boolean truthy", normalise({ identified: "true" }, "p").identified, false);
t("identified true only when explicitly boolean true", normalise({ identified: true }, "p").identified, true);
t("confidence defaults to low when missing", normalise({}, "p").confidence, "low");
t("confidence defaults to low when invalid", normalise({ confidence: "High" }, "p").confidence, "low");
t("confidence passes through when valid", normalise({ confidence: "high" }, "p").confidence, "high");

t("single bare-object candidate accepted without title/bullets",
  extractJson('{"bullet2":"x"}'), { bullet2: "x" });
t("fenced single-field refit reply accepted",
  extractJson('```json\n{"bullet2":"fixed text"}\n```'), { bullet2: "fixed text" });
t("direct array input rejected", extractJson("[1,2]"), null);
t("direct valid object accepted", extractJson('{"title":"t"}'), { title: "t" });

/* ---------- tavilySearch: auth/quota errors are fatal (#10) ---------- */
{
  const { tavilySearch } = await import("../src/lib/tavily.js");
  const realFetch = globalThis.fetch;
  const mockStatus = async status => {
    globalThis.fetch = async () => ({
      ok: false, status,
      headers: { get: () => null },
      text: async () => JSON.stringify({ error: "nope" }),
      json: async () => ({ error: "nope" })
    });
    try {
      await tavilySearch("q", "key", 6, undefined);
      return null;
    } catch (e) {
      return e._fatal === true;
    }
  };
  for (const status of [401, 403, 429, 432]) {
    t(`Tavily ${status} is marked fatal`, await mockStatus(status), true);
  }
  for (const status of [500, 502, 503]) {
    t(`Tavily ${status} is not marked fatal`, await mockStatus(status), false);
  }
  globalThis.fetch = realFetch;
}
t("prose with one embedded object still extracted",
  extractJson('Here you go:\n{"bullet0":"y"}\nThanks'), { bullet0: "y" });

{
  const key = searchCacheKey("ABC-123", { brand: "Dell" }, 6);
  t("cache miss on empty cache", searchCacheGet(key, cfg), null);
  searchCachePut(key, "q", [{ title: "t", url: "https://x", content: "c" }], cfg);
  t("cache hit after put", searchCacheGet(key, cfg)?.sources?.length, 1);
  t("cacheDays 0 disables reads even after a put",
    searchCacheGet(key, { ...cfg, cacheDays: 0 }), null);
  searchCacheClear();
  t("cache empty after clear", searchCacheCount(), 0);
}

/* ---------- csv: status/identified columns ---------- */
{
  const goodListing = normalise({
    title: S(175), bullets: [S(130), S(130), S(130), S(130), S(130)],
    description: S(1750), identified: true, _sources: []
  }, "p");
  const csv = buildCsv([{ opts: {}, status: "done", data: goodListing }], cfg);
  const header = csv.split("\r\n")[0];
  const row = csv.split("\r\n")[1];
  t("header ends with status,identified", header.endsWith(",status,identified"), true);
  t("length_ok is yes when in range", row.includes(",yes,"), true);
  t("row reports status", row.includes(",done,"), true);
  t("row reports identified yes", row.trim().endsWith(",done,yes"), true);

  const unidentified = normalise({ title: "short", description: "x", identified: false, _sources: [] }, "p");
  const badRow = buildCsv([{ opts: {}, status: "review", data: unidentified }], cfg).split("\r\n")[1];
  t("length_ok is NO when out of range", badRow.includes(",NO,"), true);
  t("row reports identified no", badRow.trim().endsWith(",review,no"), true);
}

/* ---------- liveWarnings / needsReview: stale length warnings clear once
   the field is actually fixed (#8) ---------- */
{
  const staleWarning = "Title is 12 characters, 138 short of the 150 minimum.";
  const otherWarning = "Only 1 source came back, so nothing corroborates the specs.";

  // Field is now in range, but the old warning text describing it is
  // still sitting in d.warnings from when generation finished short.
  const fixed = normalise({
    title: S(175), bullets: [S(130), S(130), S(130), S(130), S(130)],
    description: S(1750), identified: true, confidence: "high",
    warnings: [staleWarning, otherWarning],
    _sources: [{ url: "https://a" }, { url: "https://b" }]
  }, "p");

  t("stale length warning is dropped once the field is back in range",
    liveWarnings(fixed, cfg), [otherWarning]);
  t("needsReview is still true because the other warning is a real, current issue",
    needsReview(fixed, cfg), true);

  // Isolate the actual case #8 is about: once the *only* warning was
  // the stale length one, and nothing else needs review, the item
  // must stop being flagged.
  const fixedNoOtherIssue = normalise({
    title: S(175), bullets: [S(130), S(130), S(130), S(130), S(130)],
    description: S(1750), identified: true, confidence: "high",
    warnings: [staleWarning],
    _sources: [{ url: "https://a" }, { url: "https://b" }]
  }, "p");
  t("needsReview clears once the stale warning was the only issue",
    needsReview(fixedNoOtherIssue, cfg), false);

  // Field is still genuinely short — its warning text still matches a
  // real current issue, so it must NOT be filtered out.
  const stillBroken = normalise({
    title: S(12), bullets: [S(130), S(130), S(130), S(130), S(130)],
    description: S(1750), identified: true, confidence: "high",
    warnings: [staleWarning],
    _sources: [{ url: "https://a" }, { url: "https://b" }]
  }, "p");
  t("a still-genuine length warning is kept",
    liveWarnings(stillBroken, cfg).length, 1);
  t("needsReview is true while a real length issue remains",
    needsReview(stillBroken, cfg), true);

  // CSV export must agree with the editor/needsReview, not show the
  // stale text after it's been fixed.
  const csvFixed = buildCsv([{ opts: {}, status: "done", data: fixed }], cfg).split("\r\n")[1];
  t("CSV warnings column omits the stale length warning", csvFixed.includes("short of the 150 minimum"), false);
  t("CSV warnings column keeps the still-real warning", csvFixed.includes("Only 1 source"), true);
}

/* ---------- mergeRemoteItems: cross-tab sync (#1, #2, #3, #11, #12) ---------- */
{
  const now = 1_000_000;

  // #1: two tabs merging the same underlying items, with different
  // local orderings, must converge to byte-identical output — not
  // oscillate forever.
  {
    const A = [{ id: "1", part: "AAA", status: "done", data: {}, log: [] },
               { id: "2", part: "BBB", status: "queued", data: null, log: [] }];
    const B = [{ id: "2", part: "BBB", status: "queued", data: null, log: [] },
               { id: "1", part: "AAA", status: "done", data: {}, log: [] }];
    const mergedA = mergeRemoteItems(A, B, {}, now);
    const mergedB = mergeRemoteItems(B, A, {}, now);
    t("merge converges to identical order regardless of input order",
      JSON.stringify(mergedA), JSON.stringify(mergedB));
    t("merge is a no-op once both sides already agree",
      JSON.stringify(mergeRemoteItems(mergedA, mergedB, {}, now)), JSON.stringify(mergedA));
  }

  // #2: a cleared queue's empty incoming snapshot should not have
  // local-only items merged back into it. (The actual clear-wins logic
  // lives in App.jsx's itemsClearedAt check; this covers the merge
  // function's own "keep local-only items" behaviour that the caller
  // must be careful to bypass on a clear — documented via this test so
  // a future change to the merge default doesn't silently break it.)
  {
    const local = [{ id: "1", part: "AAA", status: "done", data: {}, log: [] }];
    const incomingCleared = [];
    const merged = mergeRemoteItems(local, incomingCleared, {}, now);
    t("merge alone keeps local-only items (App.jsx's clearedAt check is what must intercept a real clear)",
      merged.length, 1);
  }

  // #3: id collision between two tabs must never merge one part's data
  // onto a different part that happens to share the same id.
  {
    const local = [{ id: "5", part: "AAA", status: "queued", data: null, log: [] }];
    const incoming = [{ id: "5", part: "ZZZ", status: "queued", data: null, log: [] }];
    const merged = mergeRemoteItems(local, incoming, {}, now);
    t("id collision on different parts keeps the local side rather than overwriting it",
      merged.length === 1 && merged[0].part, "AAA");
  }

  // #11/#12: a remote "running" item is protected while its heartbeat
  // is fresh (so another tab won't re-process it), but downgraded to
  // "queued" once the heartbeat goes stale (so an abandoned item from
  // a closed/crashed tab isn't stuck forever).
  {
    const local = [{ id: "9", part: "AAA", status: "queued", data: null, log: [] }];
    const incomingRunning = [{ id: "9", part: "AAA", status: "running", data: null, log: [] }];

    const freshHb = { 9: now - 1000 };
    const mergedFresh = mergeRemoteItems(local, incomingRunning, freshHb, now);
    t("remote running item with a fresh heartbeat is adopted as running",
      mergedFresh[0].status, "running");

    const staleHb = { 9: now - 100000 };
    const mergedStale = mergeRemoteItems(local, incomingRunning, staleHb, now);
    t("remote running item with a stale heartbeat is downgraded to queued",
      mergedStale[0].status, "queued");

    t("isHeartbeatFresh true just under the timeout", isHeartbeatFresh("9", { 9: now - 44000 }, now), true);
    t("isHeartbeatFresh false just over the timeout", isHeartbeatFresh("9", { 9: now - 46000 }, now), false);
  }

  // A locally-running item with a fresh heartbeat must not be
  // overwritten by a stale remote snapshot that still says "queued" or
  // "done" from before this tab started running it.
  {
    const local = [{ id: "3", part: "AAA", status: "running", data: null, log: ["step1"] }];
    const incoming = [{ id: "3", part: "AAA", status: "queued", data: null, log: [] }];
    const merged = mergeRemoteItems(local, incoming, { 3: now - 1000 }, now);
    t("local running item with a fresh heartbeat is not overwritten by a stale remote snapshot",
      merged[0].status, "running");
  }
}

t("makeItemId produces distinct ids on successive calls", makeItemId() !== makeItemId(), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
