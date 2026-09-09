import React, { useEffect, useMemo, useRef, useState } from "react";
import ProgressBar from "./ProgressBar.jsx";

const STATUS = {
  queued: {
    dot: "pd-status-dot pd-status-queued",
    text: "Waiting",
    description: "Waiting to be processed",
  },
  running: {
    dot: "pd-status-dot pd-status-running",
    text: "Working",
    description: "Currently being processed",
  },
  done: {
    dot: "pd-status-dot pd-status-done",
    text: "Ready",
    description: "Listing is ready",
  },
  review: {
    dot: "pd-status-dot pd-status-review",
    text: "Check it",
    description: "Needs your attention",
  },
  error: {
    dot: "pd-status-dot pd-status-error",
    text: "Failed",
    description: "Processing failed",
  },
};

/* ---------- confirmation modal ---------- */

function ConfirmClear({ open, count, finished, onCancel, onConfirm }) {
  const ref = useRef(null);

  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKey = e => {
      if (e.key === "Escape") onCancel();
    };

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
      <div
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]"
        onClick={onCancel}
      />

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
          <button
            ref={ref}
            type="button"
            className="pd-btn"
            onClick={onCancel}
          >
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
  onExport,
}) {
  const [confirming, setConfirming] = useState(false);

  const stats = useMemo(() => {
    const by = {
      queued: 0,
      running: 0,
      done: 0,
      review: 0,
      error: 0,
    };

    items.forEach(i => {
      by[i.status] = (by[i.status] || 0) + 1;
    });

    const finished = by.done + by.review;

    return {
      by,
      finished,
      settled: finished + by.error,
      total: items.length,
    };
  }, [items]);

  const empty = items.length === 0;
  const exportable = items.filter(i => i.data).length;

  const confirmClear = () => {
    setConfirming(false);
    onClear();
  };

  return (
    <section
      className="pd-surface animate-fade-up"
      aria-labelledby="queue-heading"
    >
      {/* Header */}
      <div className="border-b border-slate-200/70 px-5 py-4 dark:border-slate-800/70">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full bg-emerald-500 glow-accent"
              />
              <span className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-600 dark:text-emerald-400">
                Workspace
              </span>
            </div>

            <h2
              id="queue-heading"
              className="mt-1 font-mono text-2xl font-bold tracking-tight text-slate-950 dark:text-white"
            >
              Listing Queue
            </h2>

            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Monitor every part number currently being processed.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="pd-chip">
              {empty ? "EMPTY" : `${stats.total} ITEMS`}
            </span>

            {!empty && (
              <span className="pd-chip">
                {stats.finished} READY
              </span>
            )}
          </div>
        </div>

        {!empty && (
          <ProgressBar
            className="mt-4"
            value={stats.settled}
            max={stats.total}
            live={running}
            tone="accent"
            detail={running ? "working" : `${stats.finished} ready`}
          />
        )}
      </div>

      {/* Queue body */}
      <div className="p-5">
        {empty ? (
          <div className="flex min-h-[40vh] items-center justify-center text-center">
            <div className="max-w-md">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
                <span className="pd-status-dot pd-status-queued" />
              </div>

              <h3 className="mt-4 text-lg font-semibold text-slate-800 dark:text-slate-100">
                Queue is empty
              </h3>

              <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                Paste part numbers into the Builder and start a batch.
                Processed listings will appear here automatically.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {Object.entries(STATUS).map(([key, status]) => (
                <div
                  key={key}
                  className="pd-inset flex items-center gap-2 px-3 py-2"
                >
                  <span className={status.dot} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {status.text}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-slate-700 dark:text-slate-200">
                    {stats.by[key]}
                  </span>
                </div>
              ))}
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-800/80">
              <ul className="divide-y divide-slate-200/70 dark:divide-slate-800/70">
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
                          "pd-queue-item group flex w-full items-center gap-4 px-4 py-4 text-left " +
                          (active
                            ? "pd-queue-active"
                            : "hover:bg-slate-50 dark:hover:bg-slate-900/70")
                        }
                      >
                        <span className="flex w-6 shrink-0 justify-center">
                          <span
                            className={s.dot}
                            aria-hidden="true"
                          />
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-sm font-semibold text-slate-800 dark:text-slate-100">
                            {item.part}
                          </span>

                          <span className="mt-0.5 block truncate text-xs text-slate-400 dark:text-slate-500">
                            {s.description}
                          </span>
                        </span>

                        <span className="pd-chip shrink-0">
                          {s.text}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            className="pd-btn pd-btn-xs"
            onClick={onExport}
            disabled={exportable === 0}
            title={
              exportable === 0
                ? "Nothing has finished yet"
                : `Export ${exportable} listing${exportable === 1 ? "" : "s"}`
            }
          >
            Export CSV{exportable > 0 ? ` (${exportable})` : ""}
          </button>

          <button
            type="button"
            className="pd-btn pd-btn-xs pd-btn-danger"
            onClick={() => setConfirming(true)}
            disabled={empty || running}
            title={
              empty
                ? "The queue is already empty"
                : running
                  ? "Stop the batch first"
                  : "Remove every listing from the queue"
            }
          >
            Clear queue
          </button>

          {running && (
            <span className="ml-auto self-center text-xs text-slate-400 dark:text-slate-500">
              Clearing is disabled while a batch is running.
            </span>
          )}
        </div>
      </div>

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
