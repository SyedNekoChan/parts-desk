import React from "react";
import { usingProxy } from "../lib/api.js";

/**
 * Sits at the bottom of the left rail rather than across the page, so
 * it never competes with the listing being edited. Three quiet facts
 * and a signature.
 */
export default function Footer({ tavilyUsed, tavilyMax }) {
  const left = Math.max(0, tavilyMax - tavilyUsed);

  return (
    <footer className="mt-8 border-t border-slate-200 pt-4 dark:border-slate-800">
      <dl className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="pd-hint">Searches left this month</dt>
          <dd className="font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300">
            {left.toLocaleString()}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="pd-hint">Keys</dt>
          <dd className="font-mono text-xs text-slate-600 dark:text-slate-300">
            {usingProxy ? "sent via your proxy" : "browser only"}
          </dd>
        </div>
      </dl>

      <p className="mt-4 pd-hint">
        Runs on your own free Tavily and Mistral keys. Neither free tier takes a
        payment method, so there is nothing on file to charge.
      </p>

      <p className="mt-4 flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 glow-accent"
        />
        Built by{" "}
        <span className="font-mono font-medium text-slate-600 dark:text-slate-300">
          SyedNekoChan
        </span>
      </p>
    </footer>
  );
}
