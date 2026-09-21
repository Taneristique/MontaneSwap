import Link from "next/link";

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function Footer() {
  return (
    <footer className="mt-auto border-t border-zinc-200 bg-[#F7F5F2]/80 dark:border-white/10 dark:bg-[#0B0F14]/80">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-8">
        <div className="min-w-0 space-y-1">
          <p className="text-xs leading-5 text-zinc-600 dark:text-zinc-400">
            © 2026 MontaneSwap
          </p>
          <p className="text-[11px] leading-4 text-zinc-500">
            Built for Monad Metropolis · testnet demo · not financial advice.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <Link
            href="/legal"
            className="text-xs font-medium text-zinc-600 underline-offset-2 hover:text-zinc-950 hover:underline dark:text-zinc-400 dark:hover:text-white"
          >
            Legal
          </Link>
          <Link
            href="/docs"
            className="text-xs font-medium text-zinc-600 underline-offset-2 hover:text-zinc-950 hover:underline dark:text-zinc-400 dark:hover:text-white"
          >
            Docs
          </Link>
          <a
            href="https://github.com/Taneristique"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-9 items-center gap-2 rounded-full border border-zinc-200 px-3 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-950/5 dark:border-white/15 dark:text-zinc-300 dark:hover:bg-white/10"
            aria-label="Taneristique on GitHub"
          >
            <GitHubIcon className="h-4 w-4" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
        </div>
      </div>
    </footer>
  );
}
