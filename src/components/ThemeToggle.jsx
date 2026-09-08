import React from "react";
import { useTheme } from "../hooks/useTheme.js";

function SunIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

/**
 * A switch rather than a plain button: the track slides, so the control
 * reads as a state you are in, not an action with an unknown result.
 * The icon that is *lit* is the theme you're currently using.
 */
export default function ThemeToggle({ className = "" }) {
  const { isDark, toggle } = useTheme();

  return (
    <button
      type="button"
      onClick={toggle}
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Light theme" : "Dark theme"}
      className={
        "group relative inline-flex h-8 w-[3.75rem] shrink-0 items-center rounded-full border " +
        "border-slate-200 bg-slate-100 transition-colors duration-200 " +
        "hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 " +
        className
      }
    >
      {/* Icons sit in the track, behind the knob. */}
      <SunIcon
        className={
          "pointer-events-none absolute left-[0.4rem] h-4 w-4 transition-colors duration-200 " +
          (isDark ? "text-slate-600" : "text-amber-500")
        }
      />
      <MoonIcon
        className={
          "pointer-events-none absolute right-[0.4rem] h-4 w-4 transition-colors duration-200 " +
          (isDark ? "text-emerald-400" : "text-slate-400")
        }
      />

      <span
        className={
          "pointer-events-none relative z-10 h-6 w-6 rounded-full bg-white shadow-sm ring-1 " +
          "ring-slate-900/5 transition-transform duration-200 ease-out " +
          "dark:bg-slate-700 dark:ring-white/10 " +
          (isDark ? "translate-x-[1.9rem]" : "translate-x-[0.2rem]")
        }
      />
    </button>
  );
}
