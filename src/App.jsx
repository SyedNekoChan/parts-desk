import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import ThemeToggle from "./components/ThemeToggle.jsx";
import QueueManager from "./components/QueueManager.jsx";
import ProgressBar from "./components/ProgressBar.jsx";
import Footer from "./components/Footer.jsx";
import SettingsDialog from "./components/SettingsDialog.jsx";
import ListingEditor from "./components/ListingEditor.jsx";

import {
  loadSettings, saveSettings, TAVILY_FREE_PER_MONTH,
  MAX_PART_LENGTH, localDay, localMonth
} from "./lib/settings.js";
import { readJson, writeJson, store, KEYS } from "./lib/storage.js";
import { research, normalise, needsReview, parsePartNumbers, oversizedPartCount } from "./lib/research.js";
import { searchCacheKey, searchCacheGet } from "./lib/searchCache.js";
import { resetKeyRotation } from "./lib/mistral.js";
import { downloadCsv } from "./lib/csv.js";

const CONDITIONS = ["New", "New — open box", "Refurbished", "Used — tested", "For parts", ""];

/* Rendered once per tab switch (only one branch is ever mounted at a
   time), but the markup is shared here so the two call sites can't
   drift out of sync. */
function TabBar({ activeTab, onChange, queueCount }) {
  return (
    <div className="pd-tabbar mb-6">
      <button
        type="button"
        className={"pd-tab " + (activeTab === "builder" ? "pd-tab-active" : "")}
        onClick={() => onChange("builder")}
      >
        <span className="pd-tab-indicator" />
        Builder
      </button>

      <button
        type="button"
        className={"pd-tab " + (activeTab === "queue" ? "pd-tab-active" : "")}
        onClick={() => onChange("queue")}
      >
        <span className="pd-tab-indicator" />
        Queue
        {queueCount > 0 && (
          <span className="pd-tab-count">
            {queueCount}
          </span>
        )}
      </button>
    </div>
  );
}

/* Items are persisted without their log, which is transient and can be
   long. The previous version truncated the serialised queue with
   slice(), producing a string that was no longer valid JSON — so the
   next load silently threw on parse and lost the entire queue, not just
   the overflow. Drop whole items from the oldest end instead. */
const ITEMS_BUDGET = 4000000;

function persistItems(items) {
  try {
    let slim = items.map(({ id, part, status, data, error, errorRaw, errorModel, opts }) =>
      ({ id, part, status, data, error, errorRaw, errorModel, opts }));
    let json = JSON.stringify(slim);
    while (json.length > ITEMS_BUDGET && slim.length > 1) {
      slim = slim.slice(1);
      json = JSON.stringify(slim);
    }
    store.set(KEYS.items, json);
  } catch { /* non-fatal */ }
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => {
    clearTimeout(t);
    reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
  }, { once: true });
});

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [items, setItems] = useState(() => {
    const saved = readJson(KEYS.items, []);
    return Array.isArray(saved) ? saved.map(i => ({ ...i, log: [] })) : [];
  });
  const [activeId, setActiveId] = useState(null);
  const [running, setRunning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState(null);

  const [parts, setParts] = useState("");
  const [brand, setBrand] = useState("");
  const [condition, setCondition] = useState("New");
  const [activeTab, setActiveTab] = useState("builder");

  const [tally, setTally] = useState(() => readJson(KEYS.tally, { day: localDay(), count: 0 }));
  const [tavily, setTavily] = useState(() => readJson(KEYS.tavilyQuota, { month: localMonth(), count: 0 }));

  const abortRef = useRef(null);
  const nextId = useRef(1);
  const toastTimer = useRef(null);

  // Keep the id counter ahead of anything restored from storage.
  useEffect(() => {
    nextId.current = items.reduce((m, i) => Math.max(m, i.id + 1), 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => persistItems(items), [items]);

  const notify = useCallback(msg => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);

  /* Day and month roll over while the tab is open, so both counters are
     checked against the current date rather than only at load. */
  const bumpTally = useCallback(() => {
    setTally(prev => {
      const day = localDay();
      const next = prev.day === day ? { day, count: prev.count + 1 } : { day, count: 1 };
      writeJson(KEYS.tally, next);
      return next;
    });
  }, []);

  const bumpTavily = useCallback(() => {
    setTavily(prev => {
      const month = localMonth();
      const next = prev.month === month ? { month, count: prev.count + 1 } : { month, count: 1 };
      writeJson(KEYS.tavilyQuota, next);
      return next;
    });
  }, []);

  const tavilyUsed = tavily.month === localMonth() ? tavily.count : 0;
  const doneToday = tally.day === localDay() ? tally.count : 0;

  const active = useMemo(() => items.find(i => i.id === activeId) || null, [items, activeId]);

  const updateItem = useCallback((id, patch) => {
    setItems(prev => prev.map(i => (i.id === id ? { ...i, ...patch } : i)));
  }, []);

  /* ---------- running ---------- */

  /* Runs one queue entry to completion, in place. Both the batch loop
     and the single-item retry go through here, so a retry updates the
     entry that already exists instead of appending a second one for the
     same part number. */
  const processItem = useCallback(async (item, signal, { forceFresh = false } = {}) => {
    updateItem(item.id, { status: "running", log: [] });
    setActiveId(item.id);

    const log = [];
    const onNote = e => {
      if (e.spentCredit) { bumpTavily(); return; }
      if (e.text) log.push(e.text);
      updateItem(item.id, { log: [...log] });
    };

    try {
      const raw = await research(item.part, item.opts, onNote, signal, { settings, forceFresh });
      const data = normalise(raw, item.part);
      updateItem(item.id, {
        data,
        status: needsReview(data, settings) ? "review" : "done",
        error: null, errorRaw: null, errorModel: null
      });
      bumpTally();
    } catch (err) {
      if (err.name === "AbortError") {
        updateItem(item.id, { status: "queued" });
        throw err;
      }
      updateItem(item.id, {
        status: "error",
        error: err.message || String(err),
        errorRaw: err._raw ? JSON.stringify(err._raw, null, 2) : null,
        errorModel: err._model || null
      });
    }
  }, [settings, updateItem, bumpTally, bumpTavily]);

  const rerunItem = useCallback(async (item, forceFresh) => {
    if (running) { notify("A batch is running. Stop it first, or wait for it to finish."); return; }
    if (forceFresh && !window.confirm("Discard the saved search for this part number and search Tavily again? This spends one of your 1,000 monthly searches. Nothing is charged either way.")) return;

    abortRef.current = new AbortController();
    setRunning(true);
    try {
      await processItem(item, abortRef.current.signal, { forceFresh });
    } catch (e) {
      if (e.name !== "AbortError") notify(e.message || String(e));
    }
    setRunning(false);
    abortRef.current = null;
  }, [running, processItem, notify]);

  const run = useCallback(async () => {
    if (running) { abortRef.current?.abort(); return; }

    if (!(settings.apiKeys || []).filter(Boolean).length) {
      setShowSettings(true);
      notify("Add your free Mistral key to get started.");
      return;
    }
    if (!(settings.tavilyKey || "").trim()) {
      setShowSettings(true);
      notify("Add your free Tavily key to get started.");
      return;
    }

    const parsed = parsePartNumbers(parts);
    const dropped = oversizedPartCount(parts);

    /* Dedupe against the whole queue, not just this paste. Re-pasting an
       overlapping list used to research every repeat again from
       scratch, at one Tavily credit each. */
    const already = new Set(items.map(i => i.part.trim().toUpperCase()));
    const fresh = parsed.filter(p => !already.has(p.trim().toUpperCase()));
    const repeats = parsed.length - fresh.length;

    if (!fresh.length) {
      notify(
        repeats > 0
          ? 'Every part number is already in the queue. Open one and use "Run it again" to redo it.'
          : dropped > 0
            ? `Every line was over ${MAX_PART_LENGTH} characters — too long to be a real part number.`
            : "Enter at least one part number."
      );
      return;
    }
    if (dropped > 0) notify(`Skipped ${dropped} line${dropped === 1 ? "" : "s"} over ${MAX_PART_LENGTH} characters.`);
    else if (repeats > 0) notify(`Skipped ${repeats} part number${repeats === 1 ? "" : "s"} already in the queue.`);

    const opts = { brand, condition };
    const maxResults = settings.tavilyResults || 6;

    // Only parts with no usable saved search will spend a credit.
    const willSearch = fresh.filter(p => !searchCacheGet(searchCacheKey(p, opts, maxResults), settings)).length;
    const cached = fresh.length - willSearch;
    const left = TAVILY_FREE_PER_MONTH - tavilyUsed;

    if (willSearch > left) {
      const note = cached > 0 ? ` ${cached} will reuse a saved search and cost nothing.` : "";
      if (!window.confirm(`You've used ${tavilyUsed.toLocaleString()} of this month's 1,000 free Tavily searches (${left.toLocaleString()} left) and queued ${fresh.length}, of which ${willSearch} need a fresh search.${note} The ones past the limit will fail until the monthly allowance resets. Nothing will be charged either way. Run anyway?`)) return;
    } else if (cached > 0) {
      notify(`${cached} of ${fresh.length} will reuse a saved search — no credit spent on those.`);
    }

    const batch = fresh.map(p => ({
      id: nextId.current++, part: p, status: "queued",
      data: null, error: null, log: [], opts: { ...opts }
    }));

    setItems(prev => [...prev, ...batch]);
    setParts("");
    resetKeyRotation();

    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    setRunning(true);

    for (let i = 0; i < batch.length; i++) {
      if (signal.aborted) break;
      try { await processItem(batch[i], signal); }
      catch (e) { if (e.name === "AbortError") break; }

      /* Pace the batch under the free tier's per-minute limit. A cache
         hit made no API call, so it needs no cooling-off period. */
      const next = batch[i + 1];
      const nextNeedsSearch = next && !searchCacheGet(searchCacheKey(next.part, next.opts, maxResults), settings);
      if (next && settings.gapSeconds > 0 && nextNeedsSearch) {
        try { await sleep(settings.gapSeconds * 1000, signal); }
        catch { break; }
      }
    }

    setRunning(false);
    abortRef.current = null;
  }, [running, settings, parts, brand, condition, items, tavilyUsed, processItem, notify]);

  /* ---------- queue actions ---------- */

  const clearQueue = useCallback(() => {
    setItems([]);
    setActiveId(null);
    store.del(KEYS.items);
    notify("Queue cleared. Saved searches were kept, so re-running any of these costs nothing.");
  }, [notify]);

  const exportCsv = useCallback(() => {
    const done = items.filter(i => i.data);
    if (!done.length) { notify("Nothing has finished yet."); return; }
    downloadCsv(done, settings);
    notify(`Exported ${done.length} listing${done.length === 1 ? "" : "s"}.`);
  }, [items, settings, notify]);

  useEffect(() => {
    const onBeforeUnload = e => {
      if (!running) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [running]);

  const onKeyDown = e => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); run(); }
  };

  /* ---------- render ---------- */

  const queued = parsePartNumbers(parts).length;

  return (
    <div className="min-h-full bg-transparent">
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-slate-50/80 backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-950/75">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-500 glow-accent" />
            <div className="leading-tight">
              <span className="block text-sm font-bold tracking-tight">Parts Desk</span>
              <span className="hidden text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 sm:block dark:text-slate-500">
                AI Listing Workstation
              </span>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
  <button
    className="pd-btn pd-btn-xs"
    onClick={() => setShowSettings(true)}
  >
    Settings
  </button>

  <ThemeToggle />
</div>
        </div>
      </header>

      <main className="mx-auto max-w-[88rem] px-4 py-6 sm:px-6">

  {activeTab === "builder" ? (
    <div className="grid gap-6 lg:grid-cols-[26rem_minmax(0,1fr)] lg:gap-7">
        {/* Left rail — tabs + batch panel + daily output all pinned as
            one sticky unit while the right pane scrolls. Height is
            capped to the space below the sticky offset so nothing
            inside it, including the footer, can be pushed off-screen;
            it scrolls internally on short viewports instead. */}
        <div className="lg:sticky lg:top-[4.25rem] lg:max-h-[calc(100dvh-4.25rem-1rem)] lg:self-start lg:overflow-y-auto lg:overflow-x-hidden lg:pr-0.5">
          <TabBar activeTab={activeTab} onChange={setActiveTab} queueCount={items.length} />

          <div className="pd-surface p-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="pd-section-title">New listing batch</span>
              {queued > 0 && <span className="pd-chip">{queued} queued</span>}
            </div>

            <label className="pd-label" htmlFor="parts">Part numbers</label>
            <textarea
              id="parts"
              rows={5}
              className="pd-input font-mono"
              placeholder={"YF8P5\n0X8DXD\n5CX56AA"}
              spellCheck="false"
              value={parts}
              onChange={e => setParts(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <p className="mt-1.5 pd-hint">One per line, or comma-separated. Up to 60 at a time.</p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="pd-label" htmlFor="brand">Brand hint</label>
                <input id="brand" className="pd-input" placeholder="Optional"
                       value={brand} onChange={e => setBrand(e.target.value)} />
              </div>
              <div>
                <label className="pd-label" htmlFor="condition">Condition</label>
                <select id="condition" className="pd-input" value={condition}
                        onChange={e => setCondition(e.target.value)}>
                  {CONDITIONS.map(c => (
                    <option key={c || "none"} value={c}>{c || "Not stated"}</option>
                  ))}
                </select>
              </div>
            </div>

            <button
              className={"pd-btn mt-4 w-full text-[15px] " + (running ? "pd-btn-danger" : "pd-btn-primary")}
              onClick={run}
            >
              {running ? "Stop" : queued > 0 ? `✨ Build ${queued} listing${queued === 1 ? "" : "s"}` : "✨ Build listings"}
            </button>
            <p className="mt-2 pd-hint">Ctrl/⌘ + Enter also starts a batch.</p>
          </div>

          <div className="pd-surface mt-4 p-4">
            <span className="pd-section-title">Daily output</span>
            <ProgressBar
              className="mt-3"
              label="Listings today"
              value={doneToday}
              max={settings.target}
              tone="accent"
              live={running}
              detail={`${doneToday} / ${settings.target}`}
            />
          </div>

          <div className="pb-2">
            <Footer />
          </div>
        </div>

        {/* Right pane */}
        <div className="min-w-0">
          {!active ? (
            <div className="pd-surface flex min-h-[60vh] items-center justify-center p-8 text-center">
              <div className="max-w-sm">
                <h2 className="text-lg font-semibold">Nothing selected</h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  Paste part numbers on the left and build a batch. Finished listings
                  open here for editing, with the sources they were written from.
                </p>
              </div>
            </div>
          ) : active.status === "running" ? (
            <div className="pd-surface p-6">
              <h2 className="font-mono text-xl font-semibold">{active.part}</h2>
              <ProgressBar className="mt-4" indeterminate live label="Working" detail="in progress" />
              <ul className="mt-5 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                {(active.log || []).map((l, i) => (
                  <li key={i} className="animate-fade-up">{l}</li>
                ))}
              </ul>
            </div>
          ) : active.status === "error" ? (
            <div className="pd-surface p-6">
              <h2 className="font-mono text-xl font-semibold">{active.part}</h2>
              <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
                {active.error}
              </p>
              {active.errorRaw && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-slate-600 dark:text-slate-300">
                    Raw response{active.errorModel ? ` from ${active.errorModel}` : ""}
                  </summary>
                  <pre className="pd-inset mt-2 overflow-x-auto p-3 font-mono text-xs">{active.errorRaw}</pre>
                </details>
              )}
              <div className="mt-4 flex gap-2">
                <button className="pd-btn" onClick={() => rerunItem(active, false)} disabled={running}>
                  Try this one again
                </button>
                <button className="pd-btn" onClick={() => rerunItem(active, true)} disabled={running}>
                  Search again (1 credit)
                </button>
              </div>
            </div>
          ) : active.data ? (
            <ListingEditor
              item={active}
              settings={settings}
              running={running}
              onToast={notify}
              onRerun={rerunItem}
              onChange={data => updateItem(active.id, { data })}
            />
          ) : (
            <div className="pd-surface p-6">
              <h2 className="font-mono text-xl font-semibold">{active.part}</h2>
              <p className="mt-2 pd-hint">Waiting in the queue.</p>
            </div>
          )}
        </div>
      </div>
  ) : (
    <>
      <TabBar activeTab={activeTab} onChange={setActiveTab} queueCount={items.length} />

      <QueueManager
        items={items}
        activeId={activeId}
        running={running}
        settings={settings}
        onSelect={id => {
          setActiveId(id);
          setActiveTab("builder");
        }}
        onClear={clearQueue}
        onExport={exportCsv}
      />
    </>
  )}
</main>

      <SettingsDialog
        open={showSettings}
        settings={settings}
        onClose={() => setShowSettings(false)}
        onToast={notify}
        onSave={next => { saveSettings(next); setSettings(next); resetKeyRotation(); }}
        onWiped={() => window.location.reload()}
      />

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-5 left-1/2 z-50 w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 animate-fade-up"
        >
          <div className="pd-surface px-4 py-2.5 text-sm shadow-lg">{toast}</div>
        </div>
      )}
    </div>
  );
}
