import React, { useEffect, useRef, useState } from "react";
import {
  DEFAULTS, RULES_MAX_CHARS, FORMAT_MODELS,
  normaliseLengthSettings, parseApiKeys, wipeAll
} from "../lib/settings.js";
import { listAvailableModels } from "../lib/mistral.js";
import { searchCacheCount, searchCacheClear } from "../lib/searchCache.js";

function Field({ label, hint, children, htmlFor }) {
  return (
    <div className="mb-5">
      <label className="pd-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="mt-1.5 pd-hint">{hint}</p>}
    </div>
  );
}

function Group({ legend, children }) {
  return (
    <fieldset className="mb-6 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <legend className="px-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
        {legend}
      </legend>
      {children}
    </fieldset>
  );
}

/** Min/max pair. Rendered together because the two numbers only mean
 *  anything relative to each other. */
function RangeField({ label, hint, min, max, minVal, maxVal, onMin, onMax }) {
  return (
    <Field label={label} hint={hint}>
      <div className="grid grid-cols-2 gap-2">
        <input
          type="number" className="pd-input" min={0} max={max}
          value={minVal} onChange={e => onMin(e.target.value)}
          aria-label={`${label} minimum`}
        />
        <input
          type="number" className="pd-input" min={min} max={max}
          value={maxVal} onChange={e => onMax(e.target.value)}
          aria-label={`${label} maximum`}
        />
      </div>
    </Field>
  );
}

export default function SettingsDialog({ open, settings, onSave, onClose, onToast, onWiped }) {
  const [draft, setDraft] = useState(settings);
  const [keysText, setKeysText] = useState((settings.apiKeys || []).join("\n"));
  const [models, setModels] = useState(null);
  const [checking, setChecking] = useState(false);
  const [cacheN, setCacheN] = useState(0);
  const firstRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setDraft(settings);
    setKeysText((settings.apiKeys || []).join("\n"));
    setModels(null);
    setCacheN(searchCacheCount());
    firstRef.current?.focus();
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));

  const save = () => {
    const next = { ...draft, apiKeys: parseApiKeys(keysText) };
    next.apiKey = next.apiKeys[0] || "";
    next.rules = String(next.rules || "").slice(0, RULES_MAX_CHARS);
    next.target = Math.max(1, +next.target || 40);
    next.gapSeconds = Math.max(0, +next.gapSeconds || 0);
    next.retries = Math.max(0, Math.min(8, +next.retries || 0));
    next.tavilyResults = Math.max(3, Math.min(10, +next.tavilyResults || 6));

    // Captured before normalising so we can tell the operator when a
    // typed value got clamped. Passed through as-is (not pre-converted
    // with `+`) so normaliseLengthSettings can tell an empty field
    // (falls back to default) apart from an explicitly typed 0.
    const wanted = {
      titleMin: next.titleMin, titleMax: next.titleMax,
      bulletMin: next.bulletMin, bulletMax: next.bulletMax,
      descMin: next.descMin, descMax: next.descMax
    };
    normaliseLengthSettings(next);
    const clamped = Object.keys(wanted).some(k => wanted[k] !== "" && wanted[k] != null && +wanted[k] !== next[k]);

    onSave(next);
    onToast(
      clamped
        ? "Saved, with the length limits adjusted — a minimum can't sit above its own maximum."
        : next.apiKeys.length > 1
          ? `Saved. ${next.apiKeys.length} Mistral keys configured — will rotate automatically.`
          : "Saved."
    );
    onClose();
  };

  const checkModels = async () => {
    const key = parseApiKeys(keysText)[0];
    if (!key) { onToast("Add a Mistral key first."); return; }
    setChecking(true);
    try {
      setModels(await listAvailableModels(key));
    } catch (e) {
      onToast(e.message || String(e));
    }
    setChecking(false);
  };

  const clearCache = () => {
    if (!cacheN) { onToast("No saved searches to clear."); return; }
    if (!window.confirm(`Delete ${cacheN} saved search${cacheN === 1 ? "" : "es"}? Every part number will then need a fresh Tavily search, spending one credit each.`)) return;
    const n = searchCacheClear();
    setCacheN(0);
    onToast(`Cleared ${n} saved search${n === 1 ? "" : "es"}.`);
  };

  const wipe = () => {
    if (!window.confirm("Delete your keys, settings, queue and saved searches from this browser? This can't be undone.")) return;
    wipeAll();
    onWiped();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
         role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-[2px]" onClick={onClose} />

      <div className="pd-surface relative z-10 w-full max-w-lg animate-fade-up shadow-xl">
        <header className="sticky top-0 z-10 flex items-center gap-3 rounded-t-xl border-b border-slate-200 bg-white/95 px-5 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
          <h2 id="settings-title" className="flex-1 text-base font-semibold">Settings</h2>
          <button className="pd-btn pd-btn-xs" onClick={onClose}>Close</button>
          <button className="pd-btn pd-btn-primary pd-btn-xs" onClick={save}>Save</button>
        </header>

        <div className="p-5">
          <Group legend="Search — Tavily">
            <Field
              label="Tavily API key"
              htmlFor="s-tavily"
              hint="Free tier: 1,000 searches a month, no card required. Get one at app.tavily.com."
            >
              <input
                ref={firstRef} id="s-tavily" type="password" className="pd-input font-mono"
                placeholder="tvly-..." autoComplete="off" spellCheck="false"
                value={draft.tavilyKey}
                onChange={e => set("tavilyKey", e.target.value.trim())}
              />
            </Field>

            <Field
              label="Results per search" htmlFor="s-results"
              hint="More sources means better grounding and a longer prompt. Six is a good balance."
            >
              <input id="s-results" type="number" min={3} max={10} className="pd-input"
                     value={draft.tavilyResults} onChange={e => set("tavilyResults", e.target.value)} />
            </Field>

            <Field
              label="Keep saved searches for (days)" htmlFor="s-cache"
              hint="Search results are saved per part number, so a re-run — or a part a colleague already looked up — costs no credit. Zero turns saving off, which means every run spends one."
            >
              <input id="s-cache" type="number" min={0} max={365} className="pd-input"
                     value={draft.cacheDays} onChange={e => set("cacheDays", e.target.value)} />
              <div className="mt-2 flex items-center gap-3">
                <button type="button" className="pd-btn pd-btn-xs" onClick={clearCache}>
                  Clear saved searches
                </button>
                <span className="pd-metric">{cacheN} saved</span>
              </div>
            </Field>
          </Group>

          <Group legend="Writing — Mistral">
            <Field
              label="Mistral API keys" htmlFor="s-keys"
              hint="One per line. Each free account has its own allowance, so a second key keeps a batch moving when the first is rate-limited. Free keys have no payment method attached."
            >
              <textarea
                id="s-keys" rows={3} className="pd-input font-mono"
                placeholder={"key one\nkey two"} spellCheck="false"
                value={keysText} onChange={e => setKeysText(e.target.value)}
              />
              <div className="mt-2 flex items-center gap-3">
                <button type="button" className="pd-btn pd-btn-xs" onClick={checkModels} disabled={checking}>
                  {checking ? "Checking…" : "Check available models"}
                </button>
                {models && <span className="pd-metric">{models.length} reachable</span>}
              </div>
              {models && (
                <div className="pd-inset mt-2 max-h-32 overflow-y-auto p-2">
                  <ul className="space-y-0.5 font-mono text-xs text-slate-600 dark:text-slate-300">
                    {models.map(m => <li key={m}>{m}</li>)}
                  </ul>
                </div>
              )}
            </Field>

            <Field label="Model" htmlFor="s-model" hint="Free-tier lineups change. If one stops answering, the app falls back to the other automatically.">
              <select id="s-model" className="pd-input" value={draft.formatModel}
                      onChange={e => set("formatModel", e.target.value)}>
                {FORMAT_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Gap between parts (seconds)" htmlFor="s-gap">
                <input id="s-gap" type="number" min={0} max={300} className="pd-input"
                       value={draft.gapSeconds} onChange={e => set("gapSeconds", e.target.value)} />
              </Field>
              <Field label="Retries on rate limit" htmlFor="s-retries">
                <input id="s-retries" type="number" min={0} max={8} className="pd-input"
                       value={draft.retries} onChange={e => set("retries", e.target.value)} />
              </Field>
            </div>
            <p className="-mt-2 mb-5 pd-hint">
              The gap paces a batch under the free tier's per-minute cap. It's skipped
              automatically when the next part number has a saved search.
            </p>
          </Group>

          <Group legend="Listing length">
            <RangeField
              label="Title (characters)" min={20} max={500}
              minVal={draft.titleMin} maxVal={draft.titleMax}
              onMin={v => set("titleMin", v)} onMax={v => set("titleMax", v)}
              hint="Minimum, then maximum. The maximum is a hard cap: anything over it is rewritten before you see it, and a listing that still can't be fitted is flagged rather than published quietly."
            />
            <RangeField
              label="Each bullet (characters)" min={20} max={500}
              minVal={draft.bulletMin} maxVal={draft.bulletMax}
              onMin={v => set("bulletMin", v)} onMax={v => set("bulletMax", v)}
              hint="Applies to all five bullets individually, not to their total."
            />
            <RangeField
              label="Description (characters)" min={100} max={6000}
              minVal={draft.descMin} maxVal={draft.descMax}
              onMin={v => set("descMin", v)} onMax={v => set("descMax", v)}
              hint="A high minimum on thin search results is the one setting that can push the writing model toward padding. When there genuinely isn't enough sourced material, the app leaves the description short and flags it rather than inventing specifications."
            />
            <Field
              label="Repair passes" htmlFor="s-refit"
              hint="How many times an out-of-range field is sent back to be rewritten to length. Each pass is one extra Mistral call and costs no Tavily credits. Zero turns repair off and just flags what's out of range."
            >
              <input id="s-refit" type="number" min={0} max={4} className="pd-input"
                     value={draft.refitPasses} onChange={e => set("refitPasses", e.target.value)} />
            </Field>
          </Group>

          <Group legend="House style">
            <Field
              label="Rules for every listing" htmlFor="s-rules"
              hint={`Free text, up to ${RULES_MAX_CHARS} characters. These override the built-in guidance where they conflict.`}
            >
              <textarea id="s-rules" rows={4} className="pd-input"
                        placeholder="e.g. Always write Refurbished, never Renewed."
                        value={draft.rules} onChange={e => set("rules", e.target.value.slice(0, RULES_MAX_CHARS))} />
            </Field>

            <label className="mb-5 flex items-start gap-2.5 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 dark:border-slate-700"
                     checked={draft.pnInTitle} onChange={e => set("pnInTitle", e.target.checked)} />
              <span>
                Put the part number in the title
                <span className="mt-0.5 block pd-hint">Buyers search by part number, so this usually helps.</span>
              </span>
            </label>

            <Field label="Daily target" htmlFor="s-target" hint="Only drives the progress bar in the sidebar.">
              <input id="s-target" type="number" min={1} max={500} className="pd-input"
                     value={draft.target} onChange={e => set("target", e.target.value)} />
            </Field>
          </Group>

          <div className="rounded-xl border border-rose-200 p-4 dark:border-rose-900/60">
            <p className="text-[13px] font-semibold text-rose-700 dark:text-rose-400">Clear everything</p>
            <p className="mt-1 pd-hint">
              Removes your keys, settings, queue and saved searches from this browser.
              Nothing is stored anywhere else.
            </p>
            <button type="button" className="pd-btn pd-btn-danger pd-btn-xs mt-3" onClick={wipe}>
              Clear everything
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
