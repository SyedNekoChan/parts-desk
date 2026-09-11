import React from "react";
import ToggleButton from "./ToggleButton";

export default function Header() {
  return (
    <header className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
      {/* Left side: App title */}
      <h1 className="text-lg font-semibold text-slate-700 dark:text-slate-200">
        Parts Desk
      </h1>

      {/* Right side: Toggle + watermark */}
      <div className="flex items-center gap-2">
        <ToggleButton />
        <span className="text-[11px] text-slate-400 dark:text-slate-500">
          Built by{" "}
          <span className="font-mono font-medium text-slate-600 dark:text-slate-300">
            SyedNekoChan
          </span>
        </span>
      </div>
    </header>
  );
}
