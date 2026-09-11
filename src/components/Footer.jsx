import React from "react";

export default function Footer() {
  return (
    <p className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 glow-accent"
      />
      Built by{" "}
      <span className="font-mono font-medium text-slate-600 dark:text-slate-300">
        SyedNekoChan
      </span>
    </p>
  );
}
