import {
  lengthIssues, lengthTarget, distanceOutside, stripWrapping, rangeState,
  fieldValue, setFieldValue, describeIssue
} from "../src/lib/lengths.js";
import { normaliseLengthSettings, DEFAULTS } from "../src/lib/settings.js";
import {
  searchCacheKey, searchCacheGet, searchCachePut, searchCacheCount, searchCacheClear
} from "../src/lib/searchCache.js";
import { parsePartNumbers, oversizedPartCount } from "../src/lib/research.js";
import { buildCsv } from "../src/lib/csv.js";

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  if (!ok) console.log("FAIL", label, "\n  got ", JSON.stringify(got), "\n  want", JSON.stringify(want));
};
const S = n => "x".repeat(n);
const cfg = { ...DEFAULTS };
const good = { title: S(175), bullets: [S(130), S(130), S(130), S(130), S(130)], description: S(1750) };

/* ---------- length rules ---------- */
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
t("distance under", distanceOutside(100, 150, 200), 50);

t("strips wrapping quotes", stripWrapping('"Dell"'), "Dell");
t("strips code fence", stripWrapping("```\nDell\n```"), "Dell");
t("leaves inner quotes", stripWrapping('Dell 15" panel'), 'Dell 15" panel');

t("range state over", rangeState(S(210), 150, 200).state, "over");
t("range state under", rangeState(S(10), 150, 200).state, "under");
t("range state ok", rangeState(S(175), 150, 200).state, "ok");

const o = { title: "T", description: "D", bullets: ["a", "b", "c", "d", "e"] };
t("reads a bullet by field name", fieldValue(o, "bullet3"), "d");
setFieldValue(o, "bullet3", "Z");
t("writes a bullet by field name", o.bullets[3], "Z");
t("over message reads correctly",
  describeIssue({ label: "Title", n: 210, min: 150, max: 200, over: true, delta: 10 }),
  "Title is 210 characters, 10 over the 200 hard cap.");
t("under message reads correctly",
  describeIssue({ label: "Bullet 2", n: 100, min: 120, max: 150, over: false, delta: 20 }),
  "Bullet 2 is 100 characters, 20 short of the 120 minimum.");

/* ---------- settings clamping ---------- */
t("minimum clamped to its maximum", normaliseLengthSettings({ titleMin: 900, titleMax: 200 }).titleMin, 200);
t("garbage falls back to default", normaliseLengthSettings({ descMin: "abc", descMax: null }).descMax, 2000);
t("absurd maximum capped", normaliseLengthSettings({ titleMax: 99999 }).titleMax, 500);

/* ---------- search cache ---------- */
t("key is case-insensitive on the part",
  searchCacheKey("yf8p5", { brand: "Dell" }, 6), searchCacheKey("YF8P5", { brand: "dell" }, 6));
t("condition stays out of the key",
  searchCacheKey("A", { brand: "D", condition: "New" }, 6),
  searchCacheKey("A", { brand: "D", condition: "Used" }, 6));
t("brand changes the key",
  searchCacheKey("A", { brand: "D" }, 6) === searchCacheKey("A", { brand: "H" }, 6), false);
t("result count changes the key",
  searchCacheKey("A", {}, 6) === searchCacheKey("A", {}, 10), false);

const src = n => Array.from({ length: n }, (_, i) => ({ title: "T" + i, url: "https://e/" + i, content: "c" }));
searchCacheClear();
searchCachePut("K", "q", src(3), cfg);
t("stored entry comes back", searchCacheGet("K", cfg).sources.length, 3);
t("unknown key misses", searchCacheGet("NOPE", cfg), null);
searchCachePut("EMPTY", "q", [], cfg);
t("zero-source search is never cached", searchCacheGet("EMPTY", cfg), null);
t("cacheDays 0 disables reads", searchCacheGet("K", { ...cfg, cacheDays: 0 }), null);
searchCacheClear();
searchCachePut("Z", "q", src(1), { ...cfg, cacheDays: 0 });
t("cacheDays 0 disables writes", searchCacheCount(), 0);

/* ---------- part number parsing ---------- */
t("splits and dedupes", parsePartNumbers("YF8P5\n0X8DXD, YF8P5"), ["YF8P5", "0X8DXD"]);
t("strips list markers", parsePartNumbers("- YF8P5\n1. 0X8DXD"), ["YF8P5", "0X8DXD"]);
t("drops overlong lines", parsePartNumbers("YF8P5\n" + S(60)), ["YF8P5"]);
t("counts overlong lines separately", oversizedPartCount("YF8P5\n" + S(60)), 1);

/* ---------- csv ---------- */
const base = {
  ...good, part_number: "=CMD", brand: "B", model: "M", product_type: "P",
  confidence: "high", specs: [], compatibility: [], alternate_part_numbers: [],
  warnings: [], sources: []
};
const csv = buildCsv([{ opts: { condition: "New" }, data: base }], cfg);
t("formula-injection cell is neutralised", csv.includes("'=CMD"), true);
t("length_ok is yes when in range", csv.split("\r\n")[1].includes(",yes,"), true);
const bad = buildCsv([{ opts: {}, data: { ...base, title: S(210) } }], cfg);
t("length_ok is NO when out of range", bad.split("\r\n")[1].includes(",NO,"), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
