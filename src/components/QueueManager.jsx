import React, { useEffect, useMemo, useRef, useState } from "react";
import ProgressBar from "./ProgressBar.jsx";

const STATUS = {
  queued:  { dot: "bg-slate-300 dark:bg-slate-600", text: "Waiting" },
  running: { dot: "bg-amber-500 glow-warn animate-glow-pulse", text: "Working" },
  done:    { dot: "bg-emerald-500 glow-accent", text: "Ready" },
  review:  { dot: "bg-amber-500", text: "Check it" },
  error:   { dot: "bg-rose-500", text: "Failed" }
};

/* ---------- confirmation modal ---------- */

function ConfirmClear({ open, count, finished, onCancel, onConfirm }) {
  const ref = useRef(null);

  // Focus the safe choice, not the destructive one. Someone hitting
  // Enter reflexively should cancel, not wipe their morning's work.
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clear-title"
    >
      <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]" onClick={onCancel} />

      <div className="pd-surface relative z-10 w-full max-w-md animate-fade-up p-5 shadow-xl">
        <h2 id="clear-title" className="text-base font-semibold">
          Clear {count} listing{count === 1 ? "" : "s"} from the queue?
        </h2>

        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {finished > 0
            ? `${finished} of them ${finished === 1 ? "has" : "have"} finished copy that hasn't been exported. Export the CSV first if you still need it.`
            : "Nothing here has finished, so there's no copy to lose."}
        </p>

        <p className="mt-2 pd-hint">
          Saved searches are kept, so re-running any of these part numbers costs no Tavily credit.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button ref={ref} type="button" className="pd-btn" onClick={onCancel}>
            Keep them
          </button>
          <button
            type="button"
            className="pd-btn pd-btn-danger"
            onClick={onConfirm}
          >
            Clear the queue
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- queue ---------- */

export default function QueueManager({
  items,
  activeId,
  running,
  onSelect,
  onClear,
  onExport
}) {
  const [confirming, setConfirming] = useState(false);

  const stats = useMemo(() => {
    const by = { queued: 0, running: 0, done: 0, review: 0, error: 0 };
    items.forEach(i => { by[i.status] = (by[i.status] || 0) + 1; });
    const finished = by.done + by.review;
    return { by, finished, settled: finished + by.error, total: items.length };
  }, [items]);

  const empty = items.length === 0;
  const exportable = items.filter(i => i.data).length;

  const confirmClear = () => {
    setConfirming(false);
    onClear();
  };

  return (
    <section className="mt-6" aria-labelledby="queue-heading">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="queue-heading" className="text-[13px] font-semibold text-slate-700 dark:text-slate-300">
          Queue
        </h2>
        <span className="pd-metric">
          {empty ? "empty" : `${stats.settled}/${stats.total}`}
        </span>
      </div>

      {!empty && (
        <ProgressBar
          className="mb-4"
          value={stats.settled}
          max={stats.total}
          live={running}
          tone="accent"
          detail={running ? "working" : `${stats.finished} ready`}
        />
      )}

      {empty ? (
        <p className="pd-hint">
          Nothing queued. Paste part numbers above and build your first batch.
        </p>
      ) : (
        <ul className="space-y-1">
          {items.map(item => {
            const s = STATUS[item.status] || STATUS.queued;
            const active = item.id === activeId;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect(item.id)}
                  aria-current={active ? "true" : undefined}
                  className={
                    "flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors " +
                    (active
                      ? "border-slate-300 bg-slate-100 dark:border-slate-700 dark:bg-slate-800"
                      : "border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/60")
                  }
                >
                  <span className={"h-2 w-2 shrink-0 rounded-full " + s.dot} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-slate-700 dark:text-slate-200">
                    {item.part}
                  </span>
                  <span className="pd-metric shrink-0">{s.text}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          className="pd-btn pd-btn-xs flex-1"
          onClick={onExport}
          disabled={exportable === 0}
          title={exportable === 0 ? "Nothing has finished yet" : `Export ${exportable} listing${exportable === 1 ? "" : "s"}`}
        >
          Export CSV{exportable > 0 ? ` (${exportable})` : ""}
        </button>

        <button
          type="button"
          className="pd-btn pd-btn-xs pd-btn-danger flex-1"
          onClick={() => setConfirming(true)}
          disabled={empty || running}
          title={
            empty ? "The queue is already empty"
              : running ? "Stop the batch first"
              : "Remove every listing from the queue"
          }
        >
          Clear queue
        </button>
      </div>

      {running && (
        <p className="mt-2 pd-hint">Clearing is disabled while a batch is running.</p>
      )}

      <ConfirmClear
        open={confirming}
        count={items.length}
        finished={stats.finished}
        onCancel={() => setConfirming(false)}
        onConfirm={confirmClear}
      />
    </section>
  );
}
