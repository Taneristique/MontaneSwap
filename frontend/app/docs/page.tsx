import Link from "next/link";

const toc = [
  { href: "#why", label: "Why Montane exists" },
  { href: "#what", label: "What you can do" },
  { href: "#issue", label: "Issue a cell" },
  { href: "#trade", label: "Trade the note" },
  { href: "#price-band", label: "Price band" },
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
            (not $MON), trade it on a long book, bet on its price on a short book, and settle
            risk with fixed maturity —
            repay, hunt, or season bets. Every holder of a cell&apos;s notes is paid at par
            when it repays or matures.
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
              overcollateralized cells whose health is marked to the mMonad price.
            </li>
            <li>
              <strong className="font-medium text-zinc-900 dark:text-zinc-200">Trade</strong> —
              a CLOB: real notes on the long book, a cash-settled note-price future on the
              short book.
            </li>
            <li>
              <strong className="font-medium text-zinc-900 dark:text-zinc-200">Season</strong> —
              an optional parimutuel, with no external oracle, on whether a cell&apos;s marked health
              holds above 1.10 at maturity (satellite, not a replacement for the book).
            </li>
          </ul>
        </section>

        <section id="what" className="scroll-mt-24 space-y-3">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-white">
            What you can do
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { t: "Issue", d: "Mint a cell, list its notes, stay the issuer.", h: "/issue" },
              { t: "Trade", d: "Buy/sell long or short; lift asks, hit bids.", h: "/trade" },
              { t: "Cell", d: "Hunt and repay; watch H = G/(F·P) move with the price.", h: "/cell" },
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
            Anyone with USDC can mint. Health is marked to the mMonad price:{" "}
            <code className="font-mono text-xs">H = G / (F × P_mid)</code>, where G is the
            collateral, F the face and P_mid the mMonad price in USDC. Mint requires G/F ≥ 1.10 so
            every note stays backed at par. First mint fee is <strong>25 bps</strong>. If you
            repaid and remint within 48h, fee is <strong>1 bp</strong> (roll).
          </p>
          <p>
            The issuer owes mMonad, so the price is their risk. When mMonad gets more expensive,
            the same collateral covers less of the debt and H falls toward Frostbite; when it
            gets cheaper, H rises.
          </p>
          <p>
            On mint the cell&apos;s notes (mMonad id = cell id) are escrowed in the market and
            listed as a <strong>long ask at 1.005</strong> for the full face. The short book
            starts empty.
          </p>
          <p>
            <strong>Retire:</strong> before maturity the issuer can buy notes back on the long
            book and burn them. Face F shrinks and H rises — a cheap note price helps the
            issuer.
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
            <strong>P_mid</strong> is the mMonad price: the average of the last long fill and the
            last short fill, across all cells. Every trade moves it, and with it every
            cell&apos;s H. Long orders must be priced at least <strong>0.10 above the last short
            fill</strong> and short orders at least 0.10 below the last long fill, so the two
            books always keep a spread. Fills under 1% of the cell&apos;s face do not move P_mid.
          </p>

          <h3 id="price-band" className="scroll-mt-24 pt-2 font-medium text-zinc-950 dark:text-white">
            Price band (UI today, contract on mainnet)
          </h3>
          <p>
            The spread rule gives each book only one edge. Longs have a floor (last short + 0.10)
            but no ceiling, and shorts have a ceiling (last long − 0.10, below 1.00) but no floor.
            Without a cap, one order could jump the price: with mMonad at 2.00, a long bid at
            50 would rest at 50, and a single seller filling it would print 50. P_mid would leap,
            every cell&apos;s H would collapse toward Frostbite, and Season outcomes would follow a
            single trade instead of the market.
          </p>
          <p>
            The trade desk therefore applies a <strong>±20% price band</strong>, like the
            percent-price filter on centralized exchanges:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="font-medium text-zinc-900 dark:text-zinc-200">Long book</strong> —
              price between last short + 0.10 and <strong>last long + 20%</strong>. At a last long
              of 2.00, the ceiling is 2.40.
            </li>
            <li>
              <strong className="font-medium text-zinc-900 dark:text-zinc-200">Short book</strong> —
              price between <strong>last short − 20%</strong> and last long − 0.10. At a last
              short of 0.90, the floor is 0.72.
            </li>
          </ul>
          <p>
            The allowed range is shown under the price input, and out-of-band orders are refused
            with a message before any transaction is signed. Prices can still trend: each print
            resets the reference, so a real move just takes several trades, each priced against
            the last. What the band removes is the one-shot jump.
          </p>
          <p>
            <strong>Limitation on testnet:</strong> the band lives in the frontend only. The
            deployed <code className="font-mono text-xs">CreditMarket</code> still enforces just
            the 0.10 spread, so a wallet calling the contract directly can bypass it. We kept the
            testnet bytecode frozen during the hackathon rather than redeploy the whole stack.
          </p>
          <p>
            <strong>Mainnet:</strong> the same check moves into{" "}
            <code className="font-mono text-xs">placeOrder</code> and{" "}
            <code className="font-mono text-xs">fillOrder</code>, next to the existing{" "}
            <code className="font-mono text-xs">_inSpread</code> test, with a new{" "}
            <code className="font-mono text-xs">PriceOutOfBand</code> error. The band width becomes
            a protocol parameter. The reference stays the last print, which already ignores fills
            under 1% of face, so dust trades cannot walk the band. Once enforced on-chain, the UI
            band is just a preview of the contract rule.
          </p>
          <p>
            The <strong>long book</strong> trades real notes of one cell; orders only match
            within the same cell.
          </p>
          <p>
            The <strong>short book</strong> is a cash-settled bet on the same cell&apos;s note
            price, quoted as a note price e below 1.00. Every unit locks exactly 1 USDC: the
            short puts in 1 − e, the writer (the other side) puts in e. At maturity the
            settlement price v is the cell&apos;s note TWAP, capped at 1.00 (or par if the book
            is thin: under 3 fills or under 10% of face traded). The short receives 1 − v and the writer v, so the
            short profits when notes trade below e. Holding both sides of one cell nets out at
            1 USDC per unit — that is the early exit. Short trades never touch G, F or the
            notes; they only use the note price. Open short units per cell are capped at half
            the cell&apos;s face. A TWAP on a thin book can still be pushed by traders willing to
            sell notes below par; the cap bounds what that can win.
          </p>
        </section>

        <section id="maturity" className="scroll-mt-24 space-y-3">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-white">
            24h maturity
          </h2>
          <p>
            The clock starts at <strong>first sale</strong> (else mint) + 24 hours, plus a
            minimum block delay. Until then the issuer cannot repay and holders cannot redeem.
            After it, any holder can redeem notes at par straight from the cell (pro-rata if
            H &lt; 1), and the short book can be settled. The Cell page shows a live countdown.
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
          <p>
            Novation: the hunter&apos;s bond is added to the cell&apos;s collateral and the hunter
            takes the issuer seat, including any unsold notes. The previous issuer loses their
            margin. Note holders are unaffected — the cell is now better collateralised.
          </p>
        </section>

        <section id="repay" className="scroll-mt-24 space-y-3">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-white">Repay</h2>
          <p>
            Issuer-only, Verdant (H &gt; 1.10), after maturity. Repay reserves 1 USDC for every
            outstanding note (or all of G if less), fixes the short-book settlement price,
            refunds resting orders, and returns the rest of the collateral to the issuer. Every
            holder then redeems their notes at par from Portfolio — no matter how many holders
            there are.
          </p>
        </section>

        <section id="season" className="scroll-mt-24 space-y-3">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-white">
            Season satellite
          </h2>
          <p>
            Optional vault bound to a <code className="font-mono text-xs">cdpId</code>. First
            12h after the cell opens: buy only VERDANT or only FROSTBITE at $1. Hedge packs
            (equal V+F, you choose size) stay open until market maturity. Loser pot: 10%
            treasury · 10% issuer · 80% winners. Zero losers → 1:1. No token rental in V1.
          </p>
          <h3 className="pt-2 font-medium text-zinc-950 dark:text-white">
            How a Season is decided
          </h3>
          <p>
            At maturity <strong>VERDANT</strong> wins if the cell&apos;s marked health{" "}
            <code className="font-mono text-xs">H = G / (F × P_mid)</code> is above 1.10;
            otherwise <strong>FROSTBITE</strong> wins. The settling P_mid and H are stored
            on-chain with the result.
          </p>
          <p>
            Because P_mid moves with every long and short fill, the Season is a live fight:
            long buyers push the mark up and cells toward Frostbite, shorts push it down and
            cells back to Verdant. The market is open; anyone who thinks the price is wrong can
            trade against it.
          </p>
          <p className="text-xs text-zinc-500">
            Season does not replace the CLOB. The same marked health gates hunt, repay, and the
            Winter levy.
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
            note holder (with marked H), notes to redeem, resting maker orders, short-book
            positions with settle / claim, and season
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
              [
                "mMonad",
                "The debt note: an ERC-1155 where token id = cell id, so notes of different cells never mix. Each note is a claim on 1 USDC of that cell at maturity (pro-rata if the cell is underwater). Not the Monad gas token.",
              ],
              ["Cell / CDP", "One issuer position: collateral G, face F (= mMonad supply of that id)."],
              ["Verdant", "Healthy cell: marked H = G/(F·P_mid) > 1.10."],
              ["Frostbite", "Stressed cell: marked H ≤ 1.10. Hunt opens; repay is blocked."],
              ["P_mid", "mMonad price: (last long fill + last short fill) / 2, one price for all cells."],
              ["Note TWAP", "Time-weighted long-note price on a cell; settles the short book."],
              ["Drawer", "The issuer address. Unchanged by note trades; passes to the hunter on novation."],
              ["Retire", "Issuer buys notes back and burns them, shrinking F before maturity."],
              ["Redeem", "Holders burn notes for USDC at par after repay or maturity."],
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
