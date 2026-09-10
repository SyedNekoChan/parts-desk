import {
  lengthIssues, lengthTarget, distanceOutside, stripWrapping, rangeState,
  fieldValue, setFieldValue, describeIssue
} from "../src/lib/lengths.js";
import { normaliseLengthSettings, DEFAULTS } from "../src/lib/settings.js";
import {
  searchCacheKey, searchCacheGet, searchCachePut, searchCacheCount, searchCacheClear
} from "../src/lib/searchCache.js";
import { parsePartNumbers, oversizedPartCount, normalise } from "../src/lib/research.js";
import { buildCsv } from "../src/lib/csv.js";
import { extractJson } from "../src/lib/mistral.js";

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
