import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rangeState, lengthIssues, describeIssue, liveWarnings as getLiveWarnings } from "../lib/lengths.js";
import { refitOne } from "../lib/research.js";
import { safeUrl } from "../lib/research.js";
import { distanceOutside } from "../lib/lengths.js";
import { RangeBar } from "./ProgressBar.jsx";

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

function RangeCounter({ r }) {
  const parts = r.label.split(" — ");
  const statusLabel =
    r.state === "over" ? `${r.off} over the cap`
      : r.state === "under" ? `${r.off} short of the minimum`
      : "In range";
  return (
    <div className="flex min-w-0 flex-col items-end gap-0.5">
      <Counter state={r.state} label={parts[0]} />
      <RangeBar state={r.state} />
      <span className={
        "text-[11px] font-medium " +
        (r.state === "over" ? "text-rose-600 dark:text-rose-400"
          : r.state === "under" ? "text-amber-600 dark:text-amber-400"
          : "text-slate-400 dark:text-slate-500")
      }>
        {statusLabel}
      </span>
    </div>
  );
}

function Section({ title, meta, action, children, className = "" }) {
  return (
    <section className={"pd-surface p-4 " + className}>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <span className="pd-section-title">{title}</span>
        <div className="flex items-center gap-2">
          {meta}
          {action}
        </div>
      </div>
      {children}
    </section>
  );
}

function Badge({ tone, children }) {
  const cls =
    tone === "ok" ? "pd-badge-ok"
      : tone === "bad" ? "pd-badge-bad"
      : "pd-badge-warn";
  return <span className={"pd-badge " + cls}>{children}</span>;
}

function CopyButton({ copiedKey, activeKey, onClick, children = "Copy" }) {
  const copied = copiedKey === activeKey;
  return (
    <button
      type="button"
      className={"pd-btn pd-btn-xs " + (copied ? "pd-btn-success" : "")}
      onClick={onClick}
    >
      {copied ? "Copied" : children}
    </button>
  );
}

export default function ListingEditor({ item, settings, onChange, onRerun, onToast, running }) {
  const d = item.data;
  const [fitting, setFitting] = useState(null);
  const [view, setView] = useState("edit");
  const [copiedKey, setCopiedKey] = useState(null);

  const titleR = rangeState(d.title, settings.titleMin, settings.titleMax);
  const descR = rangeState(d.description, settings.descMin, settings.descMax);

  const dRef = useRef(d);
  useEffect(() => { dRef.current = d; }, [d]);

  const patch = updates => onChange({ ...dRef.current, ...updates });

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

  const fit = async (field, value, min, max, getCurrent, applyField) => {
    setFitting(field);
    try {
      const out = await refitOne(field, value, min, max, d.sources, settings);

      if (getCurrent(dRef.current) !== value) {
        onToast("You edited this field while the rewrite was running, so it was discarded to avoid overwriting your change.");
        setFitting(null);
        return;
      }

      const before = distanceOutside(value.trim().length, min, max);
      const after = out ? distanceOutside(out.trim().length, min, max) : Infinity;
      if (out && after < before) {
        applyField(dRef.current, out);
        onToast(after === 0 ? "Fitted." : `Closer — still ${after} characters outside the range.`);
      } else {
        onToast("The rewrite didn't land any closer to the range. Left as it was.");
      }
    } catch (e) {
      onToast(e.message || String(e));
    }
    setFitting(null);
  };

  const fitField = (field, value, min, max) =>
    fit(field, value, min, max,
      cur => (field === "title" ? cur.title : cur.description),
      (cur, out) => onChange({ ...cur, [field]: out }));

  const fitBullet = (i, value, min, max) =>
    fit(`bullet${i}`, value, min, max,
      cur => cur.bullets[i] || "",
      (cur, out) => {
        const bullets = [...cur.bullets];
        bullets[i] = out;
        onChange({ ...cur, bullets });
      });

  const issues = useMemo(() => lengthIssues(d, settings), [d, settings]);

  const conf = d.confidence === "high" && d.identified ? ["ok", "HIGH CONFIDENCE"]
    : d.confidence === "low" || !d.identified ? ["bad", "NEEDS CHECKING"]
    : ["warn", "REASONABLY SURE"];

  // Shared with needsReview() and the CSV export so all three agree on
  // whether a since-fixed length warning is still showing.
  const liveWarnings = useMemo(() => getLiveWarnings(d, settings), [d, settings]);

  const flags = [
    !d.identified && "The part number couldn't be pinned to one product with confidence.",
    d.sources.length < 2 && `Only ${d.sources.length} source came back, so nothing corroborates the specs.`,
    ...liveWarnings
  ].filter(Boolean);

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

  const issueTexts = new Set(issues.map(describeIssue));
  const otherFlags = flags.filter(f => !issueTexts.has(f));
  const reviewCount = issues.length + otherFlags.length;

  return (
    <div className="mx-auto max-w-3xl">
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
            {healthPct}%
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {health.map(h => (
            <span key={h.label} className={"text-xs " + (h.ok ? "text-slate-500 dark:text-slate-400" : "text-rose-600 dark:text-rose-400 font-medium")}>
              {h.ok ? "✓" : "✕"} {h.label}
            </span>
          ))}
        </div>
        {reviewCount > 0 && (
          <ul className="mt-3 space-y-1 border-t border-slate-200/70 pt-3 text-xs text-slate-600 dark:border-slate-800/70 dark:text-slate-300">
            {issues.map(describeIssue).map((t, i) => <li key={"i" + i}>• {t}</li>)}
            {otherFlags.map((t, i) => <li key={"f" + i}>• {t}</li>)}
          </ul>
        )}
      </section>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button className="pd-btn pd-btn-primary" onClick={() => copy(wholeListing, "Listing", "whole")}>
          Copy whole listing
        </button>
        <button className="pd-btn" onClick={() => onRerun(item, false)} disabled={running}>
          Run it again
        </button>
        <button className="pd-btn" onClick={() => onRerun(item, true)} disabled={running}>
          Search again (spends a credit)
        </button>

        <div className="ml-auto flex gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-900">
          <button
            className={"pd-btn pd-btn-xs " + (view === "edit" ? "pd-btn-active" : "")}
            onClick={() => setView("edit")}
          >
            Edit
          </button>
          <button
            className={"pd-btn pd-btn-xs " + (view === "preview" ? "pd-btn-active" : "")}
            onClick={() => setView("preview")}
          >
            Preview
          </button>
        </div>
      </div>

      {view === "edit" ? (
        <div className="space-y-4">
          <Section
            title="Title"
            meta={<RangeCounter r={titleR} />}
            action={<CopyButton copiedKey={copiedKey} activeKey="title" onClick={() => copy(d.title, "Title", "title")} />}
          >
            <AutoTextarea value={d.title} onChange={v => patch({ title: v })} aria-label="Listing title" />
            <div className="mt-2">
              <button
                type="button"
                className="pd-btn pd-btn-xs"
                onClick={() => fitField("title", d.title, settings.titleMin, settings.titleMax)}
                disabled={fitting === "title" || titleR.state === "ok"}
              >
                {fitting === "title" ? "Fitting…" : "Fit to range"}
              </button>
            </div>
          </Section>

          <Section
            title="Bullets"
            action={
              <CopyButton
                copiedKey={copiedKey} activeKey="bullets"
                onClick={() => copy(d.bullets.filter(Boolean).join("\n"), "Bullets", "bullets")}
              />
            }
          >
            <div className="space-y-3">
              {d.bullets.map((b, i) => {
                const r = rangeState(b, settings.bulletMin, settings.bulletMax);
                return (
                  <div key={i} className="border-b border-slate-200/60 pb-3 last:border-0 last:pb-0 dark:border-slate-800/60">
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Bullet {i + 1}</span>
                      <RangeCounter r={r} />
                    </div>
                    <AutoTextarea
                      value={b}
                      onChange={v => setBullet(i, v)}
                      aria-label={`Bullet ${i + 1}`}
                    />
                    <div className="mt-1.5">
                      <button
                        type="button"
                        className="pd-btn pd-btn-xs"
                        onClick={() => fitBullet(i, b, settings.bulletMin, settings.bulletMax)}
                        disabled={fitting === `bullet${i}` || r.state === "ok"}
                      >
                        {fitting === `bullet${i}` ? "Fitting…" : "Fit to range"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          <Section
            title="Description"
            meta={<RangeCounter r={descR} />}
            action={<CopyButton copiedKey={copiedKey} activeKey="description" onClick={() => copy(d.description, "Description", "description")} />}
          >
            <div className="mb-2">
              {descR.state !== "ok" && (
                <button
                  type="button"
                  className="pd-btn pd-btn-xs"
                  onClick={() => fitField("description", d.description, settings.descMin, settings.descMax)}
                  disabled={fitting === "description"}
                >
                  {fitting === "description" ? "Fitting…" : "Fit to range"}
                </button>
              )}
            </div>
            <AutoTextarea
              value={d.description}
              onChange={v => patch({ description: v })}
              aria-label="Listing description"
            />
          </Section>

          <Section title="Specs">
            {d.specs.length ? (
              <table className="w-full text-sm">
                <tbody>
                  {d.specs.map((s, i) => (
                    <tr key={i} className="border-b border-slate-200/60 last:border-0 dark:border-slate-800/60">
                      <td className="py-1.5 pr-3 font-medium text-slate-500 dark:text-slate-400">{s.label}</td>
                      <td className="py-1.5 text-slate-800 dark:text-slate-100">{s.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-slate-400 dark:text-slate-500">No spec rows.</p>
            )}
          </Section>

          {(d.compatibility.length > 0 || d.alternate_part_numbers.length > 0) && (
            <Section title="Compatibility & alternates">
              {d.compatibility.length > 0 && (
                <p className="mb-2 text-sm text-slate-700 dark:text-slate-200">
                  <span className="font-medium text-slate-500 dark:text-slate-400">Compatible with: </span>
                  {d.compatibility.join(", ")}
                </p>
              )}
              {d.alternate_part_numbers.length > 0 && (
                <p className="text-sm text-slate-700 dark:text-slate-200">
                  <span className="font-medium text-slate-500 dark:text-slate-400">Alternate part numbers: </span>
                  {d.alternate_part_numbers.join(", ")}
                </p>
              )}
            </Section>
          )}

          <Section title="Sources">
            {d.sources.length ? (
              <ul className="space-y-1.5 text-sm">
                {d.sources.map((s, i) => {
                  const href = safeUrl(s.url);
                  return (
                    <li key={i}>
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sky-600 underline decoration-sky-300 underline-offset-2 hover:text-sky-700 dark:text-sky-400 dark:decoration-sky-700"
                        >
                          {s.title || href}
                        </a>
                      ) : (
                        <span className="text-slate-500 dark:text-slate-400">{s.title || "(unsafe link removed)"}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-slate-400 dark:text-slate-500">No sources recorded.</p>
            )}
          </Section>
        </div>
      ) : (
        <Section title="Preview">
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-800 dark:text-slate-100">
            {wholeListing}
          </pre>
        </Section>
      )}
    </div>
  );
}
