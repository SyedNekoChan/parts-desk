import React, { useCallback, useEffect, useRef, useState } from "react";
import { rangeState } from "../lib/lengths.js";
import { refitOne } from "../lib/research.js";
import { safeUrl } from "../lib/research.js";
import { distanceOutside } from "../lib/lengths.js";

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
  return <span className={"font-mono text-xs tabular-nums " + tone}>{label}</span>;
}

function Panel({ title, meta, action, children }) {
  return (
    <section className="pd-surface mb-4">
      <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
        <h3 className="flex-1 text-sm font-semibold">{title}</h3>
        {meta}
        {action}
      </header>
      <div className="p-4">{children}</div>
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

/* ---------- editor ---------- */

export default function ListingEditor({ item, settings, onChange, onRerun, onToast, running }) {
  const d = item.data;
  const [fitting, setFitting] = useState(null);

  const titleR = rangeState(d.title, settings.titleMin, settings.titleMax);
  const descR = rangeState(d.description, settings.descMin, settings.descMax);

  const patch = updates => onChange({ ...d, ...updates });

  const setBullet = (i, v) => {
    const bullets = [...d.bullets];
    bullets[i] = v;
    patch({ bullets });
  };

  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      onToast(`${what} copied.`);
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

  const conf = d.confidence === "high" && d.identified ? ["ok", "Confident"]
    : d.confidence === "low" || !d.identified ? ["bad", "Needs checking"]
    : ["warn", "Reasonably sure"];

  const flags = [
    !d.identified && "The part number couldn't be pinned to one product with confidence.",
    d.sources.length < 2 && `Only ${d.sources.length} source came back, so nothing corroborates the specs.`,
    ...d.warnings
  ].filter(Boolean);

  const wholeListing = [
    d.title, "",
    d.bullets.filter(Boolean).map(b => "• " + b).join("\n"), "",
    d.description
  ].join("\n");

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-3xl">{d.part_number}</h1>
          <Badge tone={conf[0]}>{conf[1]}</Badge>
          {d.fromCache && <span className="pd-chip">saved search</span>}
        </div>
        <p className="mt-2 text-sm font-medium text-slate-500 dark:text-slate-400">
          {[d.brand, d.model, d.product_type].filter(Boolean).join(" · ") || "Unidentified part"}
        </p>
      </header>

      {flags.length > 0 && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900/60 dark:bg-amber-950/30">
          <p className="font-semibold text-amber-800 dark:text-amber-300">Check before publishing</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-800/90 dark:text-amber-200/80">
            {flags.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      <div className="mb-5 flex flex-wrap gap-2">
        <button className="pd-btn pd-btn-primary" onClick={() => copy(wholeListing, "Listing")}>
          Copy the whole listing
        </button>
        <button className="pd-btn" onClick={() => onRerun(item, false)} disabled={running}>
          Run it again
        </button>
        <button className="pd-btn" onClick={() => onRerun(item, true)} disabled={running}>
          Search again (1 credit)
        </button>
      </div>

      <Panel
        title="Title"
        meta={<Counter state={titleR.state} label={titleR.label} />}
        action={
          <>
            {titleR.state !== "ok" && (
              <button
                className="pd-btn pd-btn-xs"
                disabled={fitting === "title"}
                onClick={() => fit("title", d.title, settings.titleMin, settings.titleMax, v => patch({ title: v }))}
              >
                {fitting === "title" ? "Fitting…" : "Fit to range"}
              </button>
            )}
            <button className="pd-btn pd-btn-xs" onClick={() => copy(d.title, "Title")}>Copy</button>
          </>
        }
      >
        <AutoTextarea value={d.title} onChange={v => patch({ title: v })} aria-label="Listing title" />
      </Panel>

      <Panel
        title="Bullet points"
        meta={<span className="pd-metric">{settings.bulletMin}–{settings.bulletMax} each</span>}
        action={
          <button className="pd-btn pd-btn-xs" onClick={() => copy(d.bullets.filter(Boolean).join("\n"), "Bullets")}>
            Copy
          </button>
        }
      >
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {d.bullets.map((b, i) => {
            const r = rangeState(b, settings.bulletMin, settings.bulletMax);
            return (
              <li key={i} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
                <span className="w-4 shrink-0 pt-0.5 font-mono text-xs text-slate-400">{i + 1}</span>
                <AutoTextarea
                  value={b}
                  onChange={v => setBullet(i, v)}
                  aria-label={`Bullet ${i + 1}`}
                  placeholder="Empty — this bullet didn't come back."
                />
                <span
                  className="shrink-0 pt-0.5"
                  title={
                    r.state === "over" ? `${r.off} over the ${settings.bulletMax} cap`
                      : r.state === "under" ? `${r.off} short of the ${settings.bulletMin} minimum`
                      : `Within ${settings.bulletMin}–${settings.bulletMax}`
                  }
                >
                  <Counter state={r.state} label={String(r.n)} />
                </span>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel
        title="Description"
        meta={<Counter state={descR.state} label={descR.label} />}
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
            <button className="pd-btn pd-btn-xs" onClick={() => copy(d.description, "Description")}>Copy</button>
          </>
        }
      >
        <AutoTextarea
          value={d.description}
          onChange={v => patch({ description: v })}
          aria-label="Product description"
          className="min-h-[14rem]"
        />
      </Panel>

      {d.specs.length > 0 && (
        <Panel
          title="Specifications found"
          action={
            <button
              className="pd-btn pd-btn-xs"
              onClick={() => copy(d.specs.map(s => `${s.label}: ${s.value}`).join("\n"), "Specs")}
            >
              Copy
            </button>
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
        </Panel>
      )}

      {d.compatibility.length > 0 && (
        <Panel title="Listed as compatible with">
          <div className="flex flex-wrap gap-1.5">
            {d.compatibility.map((c, i) => <span key={i} className="pd-chip">{c}</span>)}
          </div>
        </Panel>
      )}

      {d.alternate_part_numbers.length > 0 && (
        <Panel title="Equivalent part numbers">
          <div className="flex flex-wrap gap-1.5">
            {d.alternate_part_numbers.map((c, i) => <span key={i} className="pd-chip">{c}</span>)}
          </div>
        </Panel>
      )}

      <Panel title="Sources">
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
                <li key={i} className="flex gap-3 py-2 first:pt-0 last:pb-0">
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
      </Panel>
    </div>
  );
}
