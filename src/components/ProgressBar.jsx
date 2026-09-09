import React from "react";

/* Glow is reserved for live state. A bar that is running glows and
   pulses; a bar sitting at a value does not. So the glow carries
   meaning — "this is moving" — rather than decorating every bar
   equally, which is what makes a glowing UI look like a toy. */
const TONES = {
  accent: {
    fill: "bg-gradient-to-r from-emerald-500 to-emerald-400",
    glow: "glow-accent",
    text: "text-emerald-600 dark:text-emerald-400"
  },
  warn: {
    fill: "bg-gradient-to-r from-amber-500 to-yellow-400",
    glow: "glow-warn",
    text: "text-amber-600 dark:text-amber-400"
  },
  stop: {
    fill: "bg-gradient-to-r from-rose-600 to-rose-500",
    glow: "glow-stop",
    text: "text-rose-600 dark:text-rose-400"
  }
};

/**
 * @param {number} value      current amount
 * @param {number} max        the ceiling this bar measures against
 * @param {string} label      what is being measured
 * @param {string} detail     right-aligned metric text (monospace)
 * @param {boolean} live      pulse and sheen — use only while running
 * @param {boolean} indeterminate  unknown progress; shows a travelling sheen
 * @param {"auto"|"accent"|"warn"|"stop"} tone
 * @param {string} note       one quiet line under the bar
 */
export default function ProgressBar({
  value = 0,
  max = 100,
  label,
  detail,
  live = false,
  indeterminate = false,
  tone = "auto",
  note,
  className = ""
}) {
  const safeMax = Math.max(1, max);
  const pct = Math.max(0, Math.min(100, (value / safeMax) * 100));

  // Auto tone escalates as the bar approaches its ceiling, so a quota
  // gauge turns amber then red on its own.
  const resolved = tone !== "auto" ? tone : pct >= 95 ? "stop" : pct >= 80 ? "warn" : "accent";
  const t = TONES[resolved] || TONES.accent;

  return (
    <div className={className}>
      {(label || detail) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          {label && (
            <span className="text-[13px] font-medium text-slate-600 dark:text-slate-300">
              {label}
            </span>
          )}
          {detail && (
            <span className={"font-mono text-xs tabular-nums " + (live ? t.text : "text-slate-500 dark:text-slate-400")}>
              {detail}
            </span>
          )}
        </div>
      )}

      <div
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
        role="progressbar"
        aria-label={label || "Progress"}
        aria-valuemin={indeterminate ? undefined : 0}
        aria-valuemax={indeterminate ? undefined : safeMax}
        aria-valuenow={indeterminate ? undefined : Math.round(value)}
        aria-valuetext={indeterminate ? "Working" : detail || `${Math.round(pct)}%`}
      >
        {indeterminate ? (
          <>
            <div className={"absolute inset-0 rounded-full opacity-30 " + t.fill} />
            <div className={"absolute inset-y-0 w-1/3 sheen-mask animate-sheen"} />
          </>
        ) : (
          <div
            className={
              "h-full rounded-full transition-[width] duration-500 ease-out " +
              t.fill + " " +
              (live ? t.glow + " animate-glow-pulse" : "")
            }
            style={{ width: `${pct}%` }}
          />
        )}
      </div>

      {note && <p className="mt-1.5 pd-hint">{note}</p>}
    </div>
  );
}

/* Compact bar for a single field's character range. Purely a rendering
   of the rangeState() the editor already computes — no new validation
   rules, just a bar instead of a bare number. */
export function RangeBar({ n, min, max, state }) {
  const safeMax = Math.max(1, max);
  const pct =
    state === "over" ? 100
      : Math.max(4, Math.min(100, (n / safeMax) * 100));

  const fillClass =
    state === "over" ? "pd-range-fill-over"
      : state === "under" ? "pd-range-fill-under"
      : "pd-range-fill-ok";

  return (
    <div className="pd-range-track" role="presentation">
      <div className={"pd-range-fill " + fillClass} style={{ width: `${pct}%` }} />
    </div>
  );
}
