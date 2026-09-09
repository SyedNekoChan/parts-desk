import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rangeState, lengthIssues, describeIssue } from "../lib/lengths.js";
import { refitOne } from "../lib/research.js";
import { safeUrl } from "../lib/research.js";
import { distanceOutside } from "../lib/lengths.js";
import { RangeBar } from "./ProgressBar.jsx";

/* ---------- small pieces ---------- */

function AutoTextarea({ value, onChange, className = "", ...rest }) {
  const ref = useRef(null);

  const grow = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, []);

  useEffect(grow, [value, grow]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={e => { onChange(e.target.value); grow(); }}
      rows={1}
      className={
        "w-full resize-none border-0 bg-transparent p-0 text-sm leading-relaxed " +
        "text-slate-800 outline-none focus:ring-0 dark:text-slate-100 " + className
      }
      {...rest}
    />
  );
}

function Counter({ state, label }) {
  const tone =
    state === "over" ? "text-rose-600 dark:text-rose-400 font-semibold"
      : state === "under" ? "text-amber-600 dark:text-amber-400 font-semibold"
      : "text-slate-500 dark:text-slate-400";
  return (
    <span className={"break-words text-right font-mono text-xs tabular-nums " + tone}>
      {label}
    </span>
  );
}

/* Counter + range bar, stacked, for the title/description headers.
   min-w-0 on the inner wrapper is the actual fix for clipping: a flex
   item's default min-width is auto (its content's natural, unwrapped
   width), which silently overrides max-width on the outer box. Setting
   min-w-0 lets the flex algorithm actually honor the cap and wrap the
   label instead of forcing the box wider than its column.

   The top line shows just the count and its target (rangeState()'s
   label with the trailing "— N over/short" clause stripped, purely for
   display — the underlying value is untouched); the delta appears once,
   as its own short status line under the bar, instead of twice. */
function RangeCounter({ r }) {
  const shortLabel = r.label.replace(/\s*—\s*\d+\s*(over|short)$/, "");
  const statusLabel =
    r.state === "over" ? `⚠ ${r.off} over` : r.state === "under" ? `⚠ ${r.off} short` : "Good";

  return (
    <div className="flex min-w-0 max-w-[11rem] shrink-0 flex-col items-end gap-1 px-3">
      <div className="min-w-0 max-w-full">
        <Counter state={r.state} label={shortLabel} />
      </div>
      <RangeBar n={r.n} min={0} max={r.state === "under" ? r.n + r.off : r.n} state={r.state} />
      <span
        className={
          "text-right text-[10px] font-medium uppercase tracking-wide " +
          (r.state === "over" ? "text-rose-600 dark:text-rose-400"
            : r.state === "under" ? "text-amber-600 dark:text-amber-400"
            : "text-emerald-600 dark:text-emerald-400")
        }
      >
        {statusLabel}
      </span>
    </div>
  );
}

/* Document-style section: typography + a divider instead of a nested
   rounded card. Used for Title / Bullets / Description / Specs / etc.
   The header wraps onto a second row on narrow widths rather than
   compressing the divider and meta block into each other. */
function Section({ title, meta, action, children, className = "" }) {
  return (
    <section className={"pd-section " + className}>
      <header className="pd-section-head">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <h3 className="pd-section-title shrink-0">{title}</h3>
          <span className="h-px min-w-[1.5rem] flex-1 bg-slate-200 dark:bg-slate-800" aria-hidden="true" />
        </div>
        {meta}
        {action && <div className="flex items-center gap-1.5">{action}</div>}
      </header>
      {children}
    </section>
  );
}

function Badge({ tone, children }) {
  const map = {
    ok: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-400",
    warn: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-400",
    bad: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-400"
  };
  return (
    <span className={"inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium " + map[tone]}>
      {children}
    </span>
  );
}

function CopyButton({ copiedKey, activeKey, onClick, children = "Copy" }) {
  const isCopied = copiedKey === activeKey;
  return (
    <button
      className={"pd-btn pd-btn-xs " + (isCopied ? "!border-emerald-300 !text-emerald-700 dark:!border-emerald-800 dark:!text-emerald-400" : "")}
      onClick={onClick}
    >
      {isCopied ? "✓ Copied" : children}
    </button>
  );
}

/* ---------- editor ---------- */

export default function ListingEditor({ item, settings, onChange, onRerun, onToast, running }) {
  const d = item.data;
  const [fitting, setFitting] = useState(null);
  const [view, setView] = useState("edit"); // presentation-only toggle, not persisted
  const [copiedKey, setCopiedKey] = useState(null); // which Copy button last succeeded, briefly

  const titleR = rangeState(d.title, settings.titleMin, settings.titleMax);
  const descR = rangeState(d.description, settings.descMin, settings.descMax);

  const patch = updates => onChange({ ...d, ...updates });

  const setBullet = (i, v) => {
    const bullets = [...d.bullets];
    bullets[i] = v;
    patch({ bullets });
  };

  const copiedTimer = useRef(null);
  const copy = async (text, what, key) => {
    try {
      await navigator.clipboard.writeText(text);
      onToast(`${what} copied.`);
      if (key) {
        setCopiedKey(key);
        clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopiedKey(null), 1800);
      }
    } catch {
      onToast("Couldn't reach the clipboard — select and copy by hand.");
    }
  };

  const fit = async (field, value, min, max, apply) => {
    setFitting(field);
    try {
      const out = await refitOne(field, value, min, max, d.sources, settings);
      /* Accept only a rewrite that actually helped. Replacing a field
         that was 40 characters short with one 200 characters short
         would be worse than leaving it alone, and the operator would
         have no way of knowing that had happened. */
      const before = distanceOutside(value.trim().length, min, max);
      const after = out ? distanceOutside(out.trim().length, min, max) : Infinity;
      if (out && after < before) {
        apply(out);
        onToast(after === 0 ? "Fitted." : `Closer — still ${after} characters outside the range.`);
      } else {
        onToast("The rewrite didn't land any closer to the range. Left as it was.");
      }
    } catch (e) {
      onToast(e.message || String(e));
    }
    setFitting(null);
  };

  const issues = useMemo(() => lengthIssues(d, settings), [d, settings]);

  const conf = d.confidence === "high" && d.identified ? ["ok", "HIGH CONFIDENCE"]
    : d.confidence === "low" || !d.identified ? ["bad", "NEEDS CHECKING"]
    : ["warn", "REASONABLY SURE"];

  const flags = [
    !d.identified && "The part number couldn't be pinned to one product with confidence.",
    d.sources.length < 2 && `Only ${d.sources.length} source came back, so nothing corroborates the specs.`,
    ...d.warnings
  ].filter(Boolean);

  /* Listing health: a qualitative rollup of checks the app already
     performs (identification, confidence, per-field ranges, sources) —
     no new analysis, just a compact visualization of needsReview()'s
     inputs. */
  const health = [
    { ok: d.identified, label: "Product identified" },
    { ok: titleR.state === "ok", label: "Title valid" },
    { ok: !d.bullets.some(b => rangeState(b, settings.bulletMin, settings.bulletMax).state !== "ok"), label: "Bullets valid" },
    { ok: descR.state === "ok", label: "Description valid" },
    { ok: d.sources.length >= 2, label: "Sources available" }
  ];
  const healthPassed = health.filter(h => h.ok).length;
  const healthPct = Math.round((healthPassed / health.length) * 100);
  const healthTone =
    healthPct === 100 ? "ok" : healthPct >= 60 ? "warn" : "bad";

  const wholeListing = [
    d.title, "",
    d.bullets.filter(Boolean).map(b => "• " + b).join("\n"), "",
    d.description
  ].join("\n");

  /* research.js can push describeIssue()-formatted strings into
     d.warnings when its own refit pass gives up, so exclude anything
     that already appears as a structured issue to avoid listing the
     same problem twice. */
  const issueTexts = new Set(issues.map(describeIssue));
  const otherFlags = flags.filter(f => !issueTexts.has(f));
  const reviewCount = issues.length + otherFlags.length;

  return (
    <div className="mx-auto max-w-3xl">
      {/* ---------- Identity header ---------- */}
      <header className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-mono text-3xl font-bold tracking-tight text-slate-950 dark:text-white">{d.part_number}</h1>
            <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">
              {[d.brand, d.model, d.product_type].filter(Boolean).join(" · ") || "Unidentified part"}
            </p>
          </div>

          <div className="flex flex-col items-end gap-1.5">
            <Badge tone={conf[0]}>
              <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current align-middle" aria-hidden="true" />
              {conf[1]}
            </Badge>
            <div className="flex gap-1.5">
              {d.fromCache && <span className="pd-chip">saved search</span>}
              <span className="pd-chip">{d.sources.length} source{d.sources.length === 1 ? "" : "s"}</span>
            </div>
          </div>
        </div>
      </header>

      {/* ---------- Listing health ---------- */}
      <section className="pd-surface mb-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="pd-section-title">Listing health</span>
          <span
            className={
              "font-mono text-sm font-bold tabular-nums " +
              (healthTone === "ok" ? "text-emerald-600 dark:text-emerald-400"
                : healthTone === "warn" ? "text-amber-600 dark:text-amber-400"
                : "text-rose-600 dark:text-rose-400")
            }
          >
            {healthPassed} / {health.length}
          </span>
        </div>

        <div className="pd-range-track mt-2">
          <div
            className={
              "pd-range-fill " +
              (healthTone === "ok" ? "pd-range-fill-ok" : healthTone === "warn" ? "pd-range-fill-under" : "pd-range-fill-over")
            }
            style={{ width: `${healthPct}%` }}
          />
        </div>

        <ul className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
          {health.map((h, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className={h.ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"} aria-hidden="true">
                {h.ok ? "✓" : "⚠"}
              </span>
              <span className={h.ok ? "text-slate-600 dark:text-slate-300" : "text-slate-800 dark:text-slate-100"}>{h.label}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ---------- Compact review summary ---------- */}
      {(otherFlags.length > 0 || issues.length > 0) && (
        <section className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900/60 dark:bg-amber-950/30">
          <p className="font-semibold text-amber-800 dark:text-amber-300">
            ⚠ {reviewCount} item{reviewCount === 1 ? "" : "s"} need review
          </p>

          {issues.length > 0 && (
            <ul className="mt-2 space-y-1 font-mono text-xs text-amber-900/90 dark:text-amber-200/80">
              {issues.map((iss, i) => (
                <li key={i} className="flex items-center justify-between gap-3">
                  <span>{iss.label}</span>
                  <span>{iss.n} / {iss.over ? `${iss.max} maximum` : `${iss.min} minimum`}</span>
                </li>
              ))}
            </ul>
          )}

          {otherFlags.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-800/90 dark:text-amber-200/80">
              {otherFlags.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </section>
      )}

      {/* ---------- Actions ---------- */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button className="pd-btn pd-btn-primary" onClick={() => copy(wholeListing, "Listing", "whole")}>
          {copiedKey === "whole" ? "✓ Copied" : "Copy the whole listing"}
        </button>
        <button className="pd-btn" onClick={() => onRerun(item, false)} disabled={running}>
          Run it again
        </button>
        <button className="pd-btn" onClick={() => onRerun(item, true)} disabled={running}>
          Search again (1 credit)
        </button>

        <div className="ml-auto flex overflow-hidden rounded-lg border border-slate-200/80 dark:border-slate-800/80">
          <button
            type="button"
            className={"px-3 py-1.5 text-xs font-semibold transition-colors " + (view === "edit" ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950" : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800")}
            onClick={() => setView("edit")}
          >
            Edit
          </button>
          <button
            type="button"
            className={"px-3 py-1.5 text-xs font-semibold transition-colors " + (view === "preview" ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950" : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800")}
            onClick={() => setView("preview")}
          >
            Preview
          </button>
        </div>
      </div>

      {view === "preview" ? (
        <ListingPreview d={d} />
      ) : (
        <div className="pd-surface px-5 sm:px-6">
          <Section
            title="Title"
            meta={<RangeCounter r={titleR} />}
            action={
              <CopyButton copiedKey={copiedKey} activeKey="title" onClick={() => copy(d.title, "Title", "title")} />
            }
          >
            <AutoTextarea value={d.title} onChange={v => patch({ title: v })} aria-label="Listing title" />
          </Section>

          <Section
            title="Bullet points"
            meta={<span className="pd-metric">{settings.bulletMin}–{settings.bulletMax} each</span>}
            action={
              <CopyButton
                copiedKey={copiedKey}
                activeKey="bullets"
                onClick={() => copy(d.bullets.filter(Boolean).join("\n"), "Bullets", "bullets")}
              />
            }
          >
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {d.bullets.map((b, i) => {
                const r = rangeState(b, settings.bulletMin, settings.bulletMax);
                return (
                  <li key={i} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="w-4 shrink-0 pt-0.5 font-mono text-xs text-slate-400">{i + 1}</span>
                    <AutoTextarea
                      value={b}
                      onChange={v => setBullet(i, v)}
                      aria-label={`Bullet ${i + 1}`}
                      placeholder="Empty — this bullet didn't come back."
                    />
                    <span
                      className="w-24 shrink-0 pt-0.5"
                      title={
                        r.state === "over" ? `${r.off} over the ${settings.bulletMax} cap`
                          : r.state === "under" ? `${r.off} short of the ${settings.bulletMin} minimum`
                          : `Within ${settings.bulletMin}–${settings.bulletMax}`
                      }
                    >
                      <div className="flex items-center justify-end gap-1.5">
                        <Counter state={r.state} label={String(r.n)} />
                      </div>
                      <RangeBar n={r.n} min={0} max={r.state === "under" ? r.n + r.off : r.n} state={r.state} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </Section>

          <Section
            title="Description"
            meta={<RangeCounter r={descR} />}
            action={
              <>
                {descR.state !== "ok" && (
                  <button
                    className="pd-btn pd-btn-xs"
                    disabled={fitting === "description"}
                    onClick={() => fit("description", d.description, settings.descMin, settings.descMax, v => patch({ description: v }))}
                  >
                    {fitting === "description" ? "Fitting…" : "Fit to range"}
                  </button>
                )}
                <CopyButton copiedKey={copiedKey} activeKey="description" onClick={() => copy(d.description, "Description", "description")} />
              </>
            }
          >
            <AutoTextarea
              value={d.description}
              onChange={v => patch({ description: v })}
              aria-label="Product description"
              className="min-h-[14rem]"
            />
          </Section>

          {d.specs.length > 0 && (
            <Section
              title="Specifications"
              action={
                <CopyButton
                  copiedKey={copiedKey}
                  activeKey="specs"
                  onClick={() => copy(d.specs.map(s => `${s.label}: ${s.value}`).join("\n"), "Specs", "specs")}
                />
              }
            >
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {d.specs.map((s, i) => (
                    <tr key={i}>
                      <td className="w-1/3 py-2 pr-4 align-top text-slate-500 dark:text-slate-400">{s.label}</td>
                      <td className="py-2 align-top">{s.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {d.compatibility.length > 0 && (
            <Section title="Compatible with">
              <div className="flex flex-wrap gap-1.5">
                {d.compatibility.map((c, i) => <span key={i} className="pd-chip">{c}</span>)}
              </div>
            </Section>
          )}

          {d.alternate_part_numbers.length > 0 && (
            <Section title="Equivalent part numbers">
              <div className="flex flex-wrap gap-1.5">
                {d.alternate_part_numbers.map((c, i) => <span key={i} className="pd-chip">{c}</span>)}
              </div>
            </Section>
          )}

          <Section
            title="Research evidence"
            meta={<span className="pd-metric">{d.sources.length} source{d.sources.length === 1 ? "" : "s"}</span>}
            className="!pb-5"
          >
            {d.fromCache && (
              <p className="mb-3 pd-hint">
                Built from a saved search rather than a fresh one, so no Tavily credit was spent.
                Use “Search again” if the sources below look stale or wrong.
              </p>
            )}

            {d.queries?.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {d.queries.map((q, i) => (
                  <span key={i} className="pd-chip border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-400">
                    {q}
                  </span>
                ))}
              </div>
            )}

            {d.sources.length > 0 ? (
              <ol className="divide-y divide-slate-200 text-sm dark:divide-slate-800">
                {d.sources.map((s, i) => {
                  const href = safeUrl(s.url);
                  return (
                    <li key={i} className="flex gap-3 py-2 first:pt-0">
                      <span className="w-4 shrink-0 font-mono text-xs text-slate-400">{i + 1}</span>
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-emerald-700 underline decoration-emerald-300 underline-offset-2 hover:decoration-emerald-500 dark:text-emerald-400 dark:decoration-emerald-800"
                        >
                          {s.title}
                        </a>
                      ) : (
                        <span className="text-slate-500 dark:text-slate-400">
                          {s.title} <span className="pd-hint">(link dropped — not a valid web address)</span>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="pd-hint">
                {d.searchPerformed
                  ? "The search ran, but no clean URLs came back. Treat the specs above as less certain than usual."
                  : "No search was performed for this one. Treat everything above as unverified."}
              </p>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

/* ---------- read-only marketplace-style preview ---------- */
/* Presentation only: renders the same item.data the editor above
   edits, with no separate state and no new marketplace logic. */
function ListingPreview({ d }) {
  return (
    <div className="pd-surface p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {[d.brand, d.model, d.product_type].filter(Boolean).join(" · ") || "Unidentified part"}
      </p>
      <h2 className="mt-1 text-xl font-semibold leading-snug text-slate-900 dark:text-slate-50">
        {d.title || "Untitled listing"}
      </h2>

      {d.bullets.filter(Boolean).length > 0 && (
        <ul className="mt-4 space-y-1.5 text-sm text-slate-700 dark:text-slate-200">
          {d.bullets.filter(Boolean).map((b, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-emerald-600 dark:text-emerald-400" aria-hidden="true">•</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}

      {d.description && (
        <p className="mt-5 whitespace-pre-line text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {d.description}
        </p>
      )}

      {d.specs.length > 0 && (
        <div className="mt-6">
          <h3 className="pd-section-title mb-2">Specifications</h3>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {d.specs.map((s, i) => (
                <tr key={i}>
                  <td className="w-1/3 py-1.5 pr-4 align-top text-slate-500 dark:text-slate-400">{s.label}</td>
                  <td className="py-1.5 align-top">{s.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {d.compatibility.length > 0 && (
        <div className="mt-6">
          <h3 className="pd-section-title mb-2">Compatible with</h3>
          <div className="flex flex-wrap gap-1.5">
            {d.compatibility.map((c, i) => <span key={i} className="pd-chip">{c}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}
