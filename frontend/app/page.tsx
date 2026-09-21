import Link from "next/link";
import { Logo } from "@/components/Logo";

const cards = [
  {
    href: "/issue",
    kicker: "Issuer",
    title: "Issue",
    body: "Post USDC, mint mMonad at par, seed both books. First mint 25 bps (0.25%). Roll within 48h: 1 bp (0.01%).",
  },
  {
    href: "/trade",
    kicker: "CLOB",
    title: "Trade",
    body: "Long and short books do not cross each other. Fill the ask; cash goes to the rest.",
  },
  {
    href: "/cell",
    kicker: "Position",
    title: "Cell",
    body: "Hunt is a locked request for 24h. Repay settles off the book. The issuer stays the drawer.",
  },
  {
    href: "/portfolio",
    kicker: "You",
    title: "Portfolio",
    body: "Balances, issued cells, open orders, shorts, and season packs — live health at a glance.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-col gap-10 sm:gap-12">
      <section className="flex flex-col items-start gap-5 pt-2 sm:flex-row sm:items-center sm:gap-6 sm:pt-6">
        <Logo size={72} clipId="msHero" />
        <div className="max-w-xl">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
            Monad · Metropolis
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Montane Swap</h1>
          <p className="mt-3 text-base leading-7 text-zinc-600 dark:text-zinc-400">
            A debt-note book. The paper moves; the drawer does not. mMonad is
            the note, not $MON.
          </p>
        </div>
      </section>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="rounded-2xl border border-zinc-200 bg-white p-5 transition-colors hover:border-zinc-400 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/25"
          >
            <p className="text-xs uppercase tracking-wider text-zinc-500">{c.kicker}</p>
            <h2 className="mt-2 text-lg font-semibold">{c.title}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{c.body}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}
