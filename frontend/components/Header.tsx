"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";
import { Connect } from "./Connect";
import { ThemeToggle } from "./ThemeToggle";

const links = [
  { href: "/trade", label: "Trade" },
  { href: "/issue", label: "Issue" },
  { href: "/cell", label: "Cell" },
  { href: "/season", label: "Season" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/docs", label: "Docs" },
];

function Nav({ compact }: { compact?: boolean }) {
  const path = usePathname();
  return (
    <nav
      className={
        compact
          ? "flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          : "flex items-center gap-1"
      }
    >
      {links.map((l) => {
        const on = path === l.href || (l.href !== "/" && path.startsWith(l.href));
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`shrink-0 rounded-full font-medium transition-colors ${
              compact ? "min-h-9 px-3 py-2 text-xs" : "px-4 py-1.5 text-sm"
            } ${
              on
                ? "bg-zinc-950 text-white dark:bg-white dark:text-[#0B0F14]"
                : "text-zinc-600 hover:bg-zinc-950/5 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-[#F7F5F2]/90 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-white/10 dark:bg-[#0B0F14]/90">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-3 sm:h-16 sm:gap-4 sm:px-4">
        <Link href="/" className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
          <Logo size={36} clipId="msNav" />
          <span className="truncate text-sm font-semibold tracking-wide text-zinc-950 dark:text-white">
            <span className="sm:hidden">Montane</span>
            <span className="hidden sm:inline">Montane Swap</span>
          </span>
        </Link>
        <div className="hidden min-w-0 flex-1 md:flex md:justify-center">
          <Nav />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          <span className="hidden rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-500 dark:border-white/15 dark:text-zinc-400 lg:inline">
            Monad testnet
          </span>
          <ThemeToggle />
          <Connect />
        </div>
      </div>
      <div className="mx-auto flex max-w-6xl px-3 pb-2 md:hidden">
        <Nav compact />
      </div>
    </header>
  );
}
