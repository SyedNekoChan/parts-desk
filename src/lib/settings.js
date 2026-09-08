import { store, readJson, writeJson, KEYS } from "./storage.js";

export const RULES_MAX_CHARS = 3000;
export const TAVILY_FREE_PER_MONTH = 1000;
export const MAX_PART_LENGTH = 40;

/* Free-tier model lineups shift over time on every provider, so the app
   keeps a preferred model and a fallback and tries both. */
export const FORMAT_MODELS = ["mistral-small-latest", "open-mistral-nemo"];

export const DEFAULTS = {
  apiKey: "",
  apiKeys: [],
  tavilyKey: "",
  formatModel: "mistral-small-latest",
  gapSeconds: 32,
  retries: 4,
  tavilyResults: 6,
  rules: "",
  pnInTitle: true,
  target: 40,
  cacheDays: 30,

  /* Length rules. Every one is enforced twice: asked for in the prompt,
     then measured in code after the reply comes back, with a repair
     call for anything out of range. Language models cannot count
     characters, so the prompt alone is never enough. */
  titleMin: 150,
  titleMax: 200,
  bulletMin: 120,
  bulletMax: 150,
  descMin: 1500,
  descMax: 2000,
  refitPasses: 2
};

/* The six length numbers are the spine of this app, so they are
   normalised on every load rather than trusted. A saved file from an
   older version has maxes but no mins; a hand-edited one could have a
   minimum above its maximum, which would make every listing permanently
   unfittable and every repair pass a wasted API call. */
export function normaliseLengthSettings(s) {
  const num = (v, fb) => (Number.isFinite(+v) && +v > 0 ? Math.round(+v) : fb);

  s.titleMax = Math.min(500, Math.max(20, num(s.titleMax, DEFAULTS.titleMax)));
  s.titleMin = Math.min(s.titleMax, Math.max(0, num(s.titleMin, DEFAULTS.titleMin)));

  s.bulletMax = Math.min(500, Math.max(20, num(s.bulletMax, DEFAULTS.bulletMax)));
  s.bulletMin = Math.min(s.bulletMax, Math.max(0, num(s.bulletMin, DEFAULTS.bulletMin)));

  s.descMax = Math.min(6000, Math.max(100, num(s.descMax, DEFAULTS.descMax)));
  s.descMin = Math.min(s.descMax, Math.max(0, num(s.descMin, DEFAULTS.descMin)));

  s.refitPasses = Math.min(4, Math.max(0, num(s.refitPasses, DEFAULTS.refitPasses)));
  s.cacheDays = Math.min(365, Math.max(0, num(s.cacheDays, DEFAULTS.cacheDays)));
  return s;
}

/* Providers this app used before Tavily and Mistral. Anyone with one of
   these saved gets migrated silently rather than seeing "model not
   found" on their next run. */
const RETIRED_MODELS = [
  "openai/gpt-oss-20b",
  "qwen/qwen3.6-27b",
  "llama-3.3-70b-versatile"
];

export function loadSettings() {
  const s = Object.assign({}, DEFAULTS, readJson(KEYS.settings, {}));

  // Earlier versions stored one key as `apiKey`. Move it into the array
  // that supports rotation so nobody has to re-enter it.
  if (!Array.isArray(s.apiKeys)) s.apiKeys = [];
  if (s.apiKey && !s.apiKeys.includes(s.apiKey)) s.apiKeys = [s.apiKey, ...s.apiKeys];

  // The old agentic-search model setting no longer applies — search is
  // a separate Tavily call now.
  delete s.model;

  if (RETIRED_MODELS.includes(s.formatModel)) s.formatModel = DEFAULTS.formatModel;

  if (typeof s.rules === "string" && s.rules.length > RULES_MAX_CHARS) {
    s.rules = s.rules.slice(0, RULES_MAX_CHARS);
  }

  normaliseLengthSettings(s);
  writeJson(KEYS.settings, s);
  return s;
}

export function saveSettings(s) {
  writeJson(KEYS.settings, s);
}

export function parseApiKeys(text) {
  return String(text || "").split(/[\n,]+/).map(x => x.trim()).filter(Boolean);
}

export function wipeAll() {
  Object.values(KEYS).forEach(k => store.del(k));
}

export const localDay = () => new Date().toLocaleDateString("en-CA");
export const localMonth = () => localDay().slice(0, 7);
