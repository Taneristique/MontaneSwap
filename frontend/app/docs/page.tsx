import Link from "next/link";

const toc = [
  { href: "#why", label: "Why Montane exists" },
  { href: "#what", label: "What you can do" },
  { href: "#issue", label: "Issue a cell" },
  { href: "#trade", label: "Trade the note" },
  { href: "#maturity", label: "24h maturity" },
  { href: "#hunt", label: "Hunt & novation" },
  { href: "#repay", label: "Repay" },
  { href: "#season", label: "Season satellite" },
  { href: "#portfolio", label: "Portfolio" },
  { href: "#glossary", label: "Glossary" },
  { href: "/legal", label: "Legal" },
];

export default function DocsPage() {
  return (
    <div className="flex flex-col gap-10 lg:flex-row lg:gap-12">
      <aside className="lg:w-52 lg:shrink-0">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
          Docs
        </p>
        <nav className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible">
          {toc.map((t) => (
            <a
              key={t.href}
              href={t.href}
              className="shrink-0 rounded-full px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-950/5 dark:text-zinc-400 dark:hover:bg-white/10 lg:rounded-lg"
            >
              {t.label}
            </a>
          ))}
        </nav>
      </aside>

      <article className="min-w-0 flex-1 space-y-10 text-sm leading-7 text-zinc-600 dark:text-zinc-400">
        <header>
          <h1 className="text-2xl font-semibold text-zinc-950 dark:text-white sm:text-3xl">
            Introduction
          </h1>
          <p className="mt-3 max-w-2xl">
            Montane Swap is a <strong className="font-medium text-zinc-900 dark:text-zinc-200">debt-note book</strong> on
            Monad. You post USDC, mint an <code className="font-mono text-xs">mMonad</code> note
            (not $MON), seed long and short books, and settle risk with fixed maturity —
            repay, hunt, or season bets. The drawer stays the drawer.
          </p>
          <p className="mt-3 max-w-2xl text-xs text-zinc-500">
            Inspired by clear product docs such as{" "}
            <a
              href="https://docs.bondifinance.io/docs/introduction/"
              className="underline-offset-2 hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              Bondi Finance
            </a>
            : say what it is, why it exists, then how each surface works.
          </p>
        </header>

        <section id="why" className="scroll-mt-24 space-y-3">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-white">
            Why Montane exists
          </h2>
          <p>
            Most on-chain credit either hides risk behind oracles and floating rates, or
            forces everything through an AMM curve. Montane separates three jobs:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="font-medium text-zinc-900 dark:text-zinc-200">Issue</strong> —
              overcollateralized cells with transparent health G/F.
            </li>
            <li>
              <strong className="font-medium text-zinc-900 dark:text-zinc-200">Trade</strong> —
              a CLOB where long and short never cross each other.
            </li>
            <li>
              <strong className="font-medium text-zinc-900 dark:text-zinc-200">Season</strong> —
              an optional oracle-free parimutuel on the same cell’s season (satellite, not a
              replacement for the book).
            </li>
          </ul>
        </section>

        <section id="what" className="scroll-mt-24 space-y-3">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-white">
            What you can do
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { t: "Issue", d: "Mint a cell, seed both books, stay the issuer.", h: "/issue" },
              { t: "Trade", d: "Buy/sell long or short; lift asks, hit bids.", h: "/trade" },
              { t: "Cell", d: "Hunt, repay, watch H @ mark vs on-chain H.", h: "/cell" },
              { t: "Season", d: "Hedge packs + directional season bets.", h: "/season" },
              { t: "Portfolio", d: "Your debt, notes, orders, shorts, packs.", h: "/portfolio" },
            ].map((x) => (
              <Link
                key={x.h}
                href={x.h}
                className="rounded-2xl border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-400 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/25"
              >
                <p className="font-medium text-zinc-950 dark:text-white">{x.t}</p>
                <p className="mt-1 text-xs leading-5">{x.d}</p>
              </Link>
            ))}
          </div>
        </section>

        <section id="issue" className="scroll-mt-24 space-y-3">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-white">
            Issue a cell
          </h2>
          <p>
            Anyone with USDC can mint. Collateral G and face F set health{" "}
            <code className="font-mono text-xs">H = G / F</code>. Mint requires H ≥ 1.10
            (Frostbite floor). First mint fee is <strong>25 bps</strong>. If you repaid and
            remint within 48h, fee is <strong>1 bp</strong> (roll).
          </p>
          <p>
            On mint the market seeds a <strong>long ask at 1.005</strong> and a{" "}
            <strong>short ask at 0.995</strong> for the full face. Long ask escrows real
            mMonad; short ask is notional capacity against that cell.
          </p>
        </section>

        <section id="trade" className="scroll-mt-24 space-y-3">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-white">
            Trade the note
          </h2>
          <p>
            Books are <strong>long</strong> and <strong>short</strong>. Buying long is not
            selling short — the books never cross. Taker fee is <strong>5 bps</strong>.
            Timestamps are local wall clock. Issuer on a row is the drawer; maker is who
            posted the order.
          </p>
          <p>
            Filling a <strong>short ask</strong> does not transfer mMonad — it opens a short
            with USDC escrow. Cover / force-cover on repay returns escrow to the short.
          </p>
        </section>

        <section id="maturity" className="scroll-mt-24 space-y-3">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-white">
            24h maturity
          </h2>
          <p>
            The clock starts at <strong>first sale</strong> (else mint) + 24 hours, plus a
            minimum block delay. Until then: issuer cannot repay; long cannot withdraw. The
            Cell page shows a live countdown.
          </p>
        </section>

        <section id="hunt" className="scroll-mt-24 space-y-3">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-white">
            Hunt & novation
          </h2>
          <p>
            Hunt is Frostbite-only (on-chain H ≤ 1.10). During the first 24h it is a{" "}
            <strong>request that locks bond B</strong>, not instant novation. After maturity:
            if the cell recovered to Verdant, the bond is slashed to the issuer; if still
            Frostbite, the cell novates to the hunter.
          </p>
        </section>

        <section id="repay" className="scroll-mt-24 space-y-3">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-white">Repay</h2>
          <p>
            Issuer-only, Verdant (H &gt; 1.10), after maturity. Repay does not walk the book:
            shorts are force-covered from escrow; longs are paid from the cell up to mark;
            leftover collateral returns to the issuer.
          </p>
        </section>

        <section id="season" className="scroll-mt-24 space-y-3">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-white">
            Season satellite
          </h2>
          <p>
            Optional vault bound to a <code className="font-mono text-xs">cdpId</code>. First
            12h after the cell opens: buy only VERDANT or only FROSTBITE at $1. Hedge packs
            (equal V+F, you choose size) stay open until market maturity. Resolution uses
            on-chain H &gt; 1.10 → VERDANT wins; else FROSTBITE. Loser pot: 10% treasury · 10%
            issuer · 80% winners. Zero losers → 1:1. No token rental in V1.
          </p>
          <p className="text-xs text-zinc-500">
            Season does not replace the CLOB. It is a parallel prediction surface on the same
            cell health.
          </p>
        </section>

        <section id="portfolio" className="scroll-mt-24 space-y-3">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-white">
            Portfolio
          </h2>
          <p>
            <Link href="/portfolio" className="font-medium underline-offset-2 hover:underline">
              Portfolio
            </Link>{" "}
            shows your USDC and mMonad mark-to-market, issued debt, cells where you are issuer or
            long owner (with H @ mark), resting maker orders, short size + escrow, and season
            positions with cost / mark / PnL (unresolved marked at cost; resolved mark =
            claim preview).
          </p>
        </section>

        <section id="glossary" className="scroll-mt-24 space-y-3">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-white">
            Glossary
          </h2>
          <dl className="space-y-3">
            {[
              ["mMonad", "The debt note ERC-20. Not the Monad gas token."],
              ["Cell / CDP", "One issuer position: collateral G, face F, long owner."],
              ["Verdant", "Healthy season: H > 1.10 (on-chain G/F)."],
              ["Frostbite", "Stressed season: H ≤ 1.10."],
              ["P_mid / mark", "Display mid from the live book; mark used for H @ mark."],
              ["Drawer", "The issuer address — does not change when the note trades."],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="font-medium text-zinc-950 dark:text-white">{k}</dt>
                <dd className="mt-0.5">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      </article>
    </div>
  );
}
