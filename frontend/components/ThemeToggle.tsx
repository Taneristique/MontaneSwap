"use client";

import { useTheme } from "next-themes";
import { useIsClient } from "@/lib/use-is-client";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const light = useIsClient() && resolvedTheme === "light";

  return (
    <button
      type="button"
      aria-label={light ? "Switch to dark" : "Switch to light"}
      onClick={() => setTheme(light ? "dark" : "light")}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 text-zinc-700 dark:border-white/15 dark:text-zinc-200"
    >
      {light ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M21 14.3A9 9 0 1 1 9.7 3 7 7 0 0 0 21 14.3z" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )}
    </button>
  );
}
