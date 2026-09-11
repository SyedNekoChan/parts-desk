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
import { resetKeyRotation, resetModelMemory } from "./lib/mistral.js";
import { downloadCsv } from "./lib/csv.js";

const CONDITIONS = ["New", "New — open box", "Refurbished", "Used — tested", "For parts", ""];

function TabBar({ activeTab, onChange, queueCount }) {
  return (
    <div className="pd-tabbar mb-6 inline-flex">
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

const ITEMS_BUDGET = 4000000;

function persistItems(items, notify) {
  let slim = items.map(({ id, part, status, data, error, errorRaw, errorModel, opts }) =>
    ({ id, part, status, data, error, errorRaw, errorModel, opts }));
  let json = JSON.stringify(slim);
  while (json.length > ITEMS_BUDGET && slim.length > 1) {
    slim = slim.slice(1);
    json = JSON.stringify(slim);
  }
  const ok = store.set(KEYS.items, json);
  if (!ok && notify) notify("The queue is too large for this browser to save — it will not survive a reload. Export finished listings and clear some completed items.");
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => {
    clearTimeout(t);
    reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
  }, { once: true });
});

/* Multi-tab merge for the persisted queue. The native `storage` event
   only fires in *other* tabs than the one that wrote — never the tab
   that made the change — so there is no risk of an update loop from
   simply reacting to it.

   A naive "replace local state with whatever's in the event" would
   let a background tab clobber an item this tab is actively running
   (its in-memory "running" status and live log are the only copy of
   that fact; the other tab's snapshot still says "queued" or "done"
   from before this tab started). So the merge is by id, and for any
   id present in both, the local copy wins whenever this tab considers
   it authoritative (actively running, or already finished with data
   the incoming copy lacks); otherwise the incoming copy wins, since it
   reflects a change (a run finishing, a rerun, a clear) that happened
   in the other tab and this tab doesn't know about yet. Items that
   only exist on one side (added in one tab, not yet seen in the other)
   are kept rather than dropped, so nothing is silently lost. */
function mergeRemoteItems(local, incoming) {
  const localById = new Map(local.map(i => [i.id, i]));
  const incomingById = new Map(incoming.map(i => [i.id, i]));
  const ids = new Set([...localById.keys(), ...incomingById.keys()]);

  const merged = [];
  for (const id of ids) {
    const loc = localById.get(id);
    const inc = incomingById.get(id);
    if (loc && !inc) { merged.push(loc); continue; }
    if (inc && !loc) { merged.push({ ...inc, log: [] }); continue; }

    const localAuthoritative =
      loc.status === "running" ||
      (loc.status !== "queued" && !inc.data && loc.data);

    merged.push(localAuthoritative ? loc : { ...inc, log: loc.log || [] });
  }

  // Preserve relative order as closely as possible: local order first,
  // then anything new that only exists remotely, appended at the end.
  const order = [...local.map(i => i.id), ...incoming.map(i => i.id).filter(id => !localById.has(id))];
  const byId = new Map(merged.map(i => [i.id, i]));
  return order.map(id => byId.get(id)).filter(Boolean);
}

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [items, setItems] = useState(() => {
    const saved = readJson(KEYS.items, []);
    return Array.isArray(saved)
      ? saved.map(i => ({ ...i, log: [], status: i.status === "running" ? "queued" : i.status }))
      : [];
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
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  useEffect(() => {
    nextId.current = items.reduce((m, i) => Math.max(m, i.id + 1), 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const notify = useCallback(msg => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);

  useEffect(() => persistItems(items, notify), [items, notify]);

  /* Cross-tab sync. The browser's `storage` event fires in every tab
     except the one that wrote, so this can only ever react to a
     *different* tab's change — there is no path back to the tab that
     made the write, which is what rules out an update loop. Settings
     and the day/month counters are simple last-write-wins (there's
     nothing to lose by taking whichever value is newest); the queue
     itself goes through mergeRemoteItems so an in-progress run in this
     tab can't be overwritten by a stale snapshot from another. */
  useEffect(() => {
    const onStorage = e => {
      if (!e.key || e.newValue == null) return;

      if (e.key === KEYS.items) {
        let incoming;
        try { incoming = JSON.parse(e.newValue); } catch { return; }
        if (!Array.isArray(incoming)) return;
        setItems(prev => mergeRemoteItems(prev, incoming));
        return;
      }
      if (e.key === KEYS.settings) {
        try { setSettings(JSON.parse(e.newValue)); } catch { /* ignore malformed */ }
        return;
      }
      if (e.key === KEYS.tally) {
        try {
          const next = JSON.parse(e.newValue);
          setTally(prev => (next.day === localDay() && next.count > prev.count ? next : prev));
        } catch { /* ignore malformed */ }
        return;
      }
      if (e.key === KEYS.tavilyQuota) {
        try {
          const next = JSON.parse(e.newValue);
          setTavily(prev => (next.month === localMonth() && next.count > prev.count ? next : prev));
        } catch { /* ignore malformed */ }
        return;
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

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
      if (err._fatal) throw err;
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

  const runQueued = useCallback(async (queuedItems, maxResults) => {
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    setRunning(true);

    let haltedByFatalError = null;

    for (let i = 0; i < queuedItems.length; i++) {
      if (signal.aborted) break;
      try {
        await processItem(queuedItems[i], signal);
      } catch (e) {
        if (e.name === "AbortError") break;
        if (e._fatal) { haltedByFatalError = e; break; }
      }

      const next = queuedItems[i + 1];
      if (next && settings.gapSeconds > 0) {
        try { await sleep(settings.gapSeconds * 1000, signal); }
        catch { break; }
      }
    }

    setRunning(false);
    abortRef.current = null;

    if (haltedByFatalError) {
      notify(`Stopped: ${haltedByFatalError.message}`);
    }
  }, [settings.gapSeconds, processItem, notify]);

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

    const maxResults = settings.tavilyResults || 6;
    const stillQueued = items.filter(i => i.status === "queued");

    const parsed = parsePartNumbers(parts);
    const dropped = oversizedPartCount(parts);

    const already = new Set(items.map(i => i.part.trim().toUpperCase()));
    const fresh = parsed.filter(p => !already.has(p.trim().toUpperCase()));
    const repeats = parsed.length - fresh.length;

    if (!fresh.length) {
      if (stillQueued.length) {
        resetKeyRotation();
        await runQueued(stillQueued, maxResults);
        return;
      }
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

    await runQueued([...stillQueued, ...batch], maxResults);
  }, [running, settings, parts, brand, condition, items, tavilyUsed, runQueued, notify]);

  const clearQueue = useCallback(() => {
    setItems([]);
    setActiveId(null);
    store.del(KEYS.items);
    notify("Queue cleared. Saved searches were kept, so re-running any of these costs nothing.");
  }, [notify]);

  const exportCsv = useCallback(() => {
    const done = items.filter(i => i.data && i.status !== "error");
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

          <span className="watermark">Built by SyedNekoChan</span>
      </div>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              className="pd-btn pd-btn-sm"
              onClick={() => setShowSettings(true)}
            >
              Settings
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6" onKeyDown={onKeyDown}>
        {activeTab === "builder" && !active && (
          <>
            <TabBar activeTab={activeTab} onChange={setActiveTab} queueCount={items.length} />

            <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
              <section className="pd-panel p-5">
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400" htmlFor="parts-input">
                  Part numbers
                </label>
                <textarea
                  id="parts-input"
                  className="pd-input min-h-[160px] font-mono text-sm"
                  placeholder={"One per line, or comma/semicolon separated.\nUp to 60 per batch."}
                  value={parts}
                  onChange={e => setParts(e.target.value)}
                />

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400" htmlFor="brand-input">
                      Brand hint (optional)
                    </label>
                    <input id="brand-input" className="pd-input" placeholder="e.g. Dell, HP, Lenovo"
                           value={brand} onChange={e => setBrand(e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400" htmlFor="condition-input">
                      Condition
                    </label>
                    <select id="condition-input" className="pd-input" value={condition}
                            onChange={e => setCondition(e.target.value)}>
                      {CONDITIONS.map(c => <option key={c} value={c}>{c || "Not specified"}</option>)}
                    </select>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <button type="button" className="pd-btn pd-btn-primary" onClick={run}>
                    {running ? "Stop" : queued > 0 ? `Run ${queued} part${queued === 1 ? "" : "s"}` : "Run"}
                  </button>
                  {running && <span className="text-xs text-slate-500 dark:text-slate-400">Processing…</span>}
                </div>
              </section>

              <aside className="pd-panel p-5">
                <ProgressBar
                  label="Today"
                  value={doneToday}
                  max={settings.target}
                  detail={`${doneToday} / ${settings.target}`}
                />
                <div className="mt-4 text-xs text-slate-500 dark:text-slate-400">
                  Tavily used this month: {tavilyUsed.toLocaleString()} / {TAVILY_FREE_PER_MONTH.toLocaleString()}
                </div>
              </aside>
            </div>
          </>
        )}

        {activeTab === "builder" && active && (
          <>
            <button type="button" className="pd-btn pd-btn-sm mb-4" onClick={() => setActiveId(null)}>
              ← Back
            </button>
            <ListingEditor
              item={active}
              settings={settings}
              running={running}
              onRerun={rerunItem}
              onChange={data => updateItem(active.id, { data })}
              onToast={notify}
            />
          </>
        )}

        {activeTab === "queue" && (
          <>
            <TabBar activeTab={activeTab} onChange={setActiveTab} queueCount={items.length} />
            <QueueManager
              items={items}
              running={running}
              settings={settings}
              onSelect={id => { setActiveId(id); setActiveTab("builder"); }}
              onExport={exportCsv}
              onClear={clearQueue}
            />
          </>
        )}
      </main>

      <SettingsDialog
        open={showSettings}
        settings={settings}
        onClose={() => setShowSettings(false)}
        onToast={notify}
        onSave={next => { saveSettings(next); setSettings(next); resetKeyRotation(); resetModelMemory(); }}
        onWiped={() => window.location.reload()}
      />

      {toast && (
        <div
          className="pd-toast fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-slate-100 dark:text-slate-900"
          role="status"
        >
          {toast}
        </div>
      )}

      <Footer />
    </div>
  );
}
