import { useCallback, useEffect, useState } from "react";
import { store, KEYS } from "../lib/storage.js";

const query = () =>
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

function initialTheme() {
  const saved = store.get(KEYS.theme);
  if (saved === "dark" || saved === "light") return saved;
  return query()?.matches ? "dark" : "light";
}

/**
 * Class-strategy dark mode.
 *
 * `explicit` distinguishes "the operator chose this" from "we inferred
 * it from the OS". Only the inferred case follows the OS when it
 * changes: once someone has picked a theme, flipping their laptop to
 * night mode shouldn't override that choice underneath them.
 *
 * The initial class is set by an inline script in index.html, before
 * first paint. This hook keeps it in sync afterwards.
 */
export function useTheme() {
  const [theme, setTheme] = useState(initialTheme);
  const [explicit, setExplicit] = useState(() => {
    const saved = store.get(KEYS.theme);
    return saved === "dark" || saved === "light";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    if (explicit) return;
    const mq = query();
    if (!mq) return;

    const onChange = e => setTheme(e.matches ? "dark" : "light");
    // Safari below 14 only has the deprecated listener API.
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);

    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, [explicit]);

  const toggle = useCallback(() => {
    setTheme(prev => {
      const next = prev === "dark" ? "light" : "dark";
      store.set(KEYS.theme, next);
      return next;
    });
    setExplicit(true);
  }, []);

  const followSystem = useCallback(() => {
    store.del(KEYS.theme);
    setExplicit(false);
    setTheme(query()?.matches ? "dark" : "light");
  }, []);

  return { theme, isDark: theme === "dark", explicit, toggle, followSystem };
}
