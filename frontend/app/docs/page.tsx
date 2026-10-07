import Link from "next/link";
import type { ReactNode } from "react";

const toc = [
  { href: "#problem", label: "The problem" },
  { href: "#how", label: "How it works" },
  { href: "#health", label: "Health, priced live" },
  { href: "#lifecycle", label: "Life of a cell" },
  { href: "#roles", label: "Who uses it" },
  { href: "#revenue", label: "Revenue" },
  { href: "#monad", label: "Why Monad" },
  { href: "#safety", label: "Safety rails" },
  { href: "#reference", label: "Reference" },
  { href: "#glossary", label: "Glossary" },
  { href: "/legal", label: "Legal" },
];

const strong = "font-medium text-zinc-900 dark:text-zinc-200";
const card =
  "rounded-2xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-4">
      <h2 className="text-xl font-semibold text-zinc-950 dark:text-white">{title}</h2>
      {children}
    </section>
  );
}

function Ref({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className={`${card} group`}>
      <summary className="cursor-pointer list-none font-medium text-zinc-950 marker:hidden dark:text-white">
        <span className="mr-2 inline-block transition-transform group-open:rotate-90">›</span>
        {title}
      </summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  );
}

const steps = [
  {
    n: "1",
    t: "Issue",
    d: "Post USDC, mint notes. Each note is a promise to pay 1 USDC. Collateral must cover at least 1.10× the face.",
  },
  {
    n: "2",
    t: "Trade",
    d: "Notes list on an onchain order book. Buy them on the long book, or bet on their price on the cash-settled short book.",
  },
  {
    n: "3",
    t: "Mark",
    d: "Every fill sets the mMonad price. Every cell's health is re-marked to that price, live.",
  },
  {
    n: "4",
    t: "Settle",
    d: "After 24h: a healthy issuer repays, a stressed cell is taken over by a hunter. Holders are paid at par.",
  },
];

const roles = [
  { t: "Issuer", w: "Raises USDC against collateral.", e: "Keeps the seat while healthy, earns 10% of the losing Season pot." },
  { t: "Note buyer", w: "Wants a dated claim on USDC.", e: "Holds notes redeemable at 1 USDC each after maturity." },
  { t: "Short", w: "Thinks notes are overpriced.", e: "Profits when the note settles below the entry price." },
  { t: "Hunter", w: "Wants a cheap issuer seat.", e: "Recapitalizes a Frostbite cell and takes it over." },
  { t: "Season bettor", w: "Has a view on a cell's health.", e: "Bets Verdant or Frostbite, winners split 80% of the losing side." },
];

const revenue = [
  ["Issuance", "25 bps of face", "1 bp if the same issuer remints within 48h of repaying"],
  ["Trading", "5 bps taker fee", "Long and short books"],
  ["Winter levy", "1% of the hunter's bond", "Only when the hunted cell is underwater (H ≤ 1)"],
  ["Season", "10% of the losing pot", "Another 10% goes to the cell's issuer"],
];

const rails = [
  ["0.10 spread", "Long orders ≥ last short + 0.10, short orders ≤ last long − 0.10. The books never cross."],
  ["1% print floor", "Fills under 1% of a cell's face don't move the price, so dust trades can't steer health."],
  ["Short cap", "Open shorts per cell are capped at half its face."],
  ["±20% price band", "One order can move the price at most 20%. Enforced in the UI today, in the contract on mainnet."],
  ["Guardian pause", "An emergency pause, no discretionary price controls."],
];

export default function DocsPage() {
  return (
    <div className="flex flex-col gap-10 lg:flex-row lg:gap-12">
      <aside className="lg:w-52 lg:shrink-0">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">Docs</p>
        <nav className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:sticky lg:top-24 lg:flex-col lg:gap-1 lg:overflow-visible">
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

      <article className="min-w-0 flex-1 space-y-14 text-sm leading-7 text-zinc-600 dark:text-zinc-400">
        <header className="space-y-5">
          <h1 className="text-3xl font-semibold leading-tight text-zinc-950 dark:text-white sm:text-4xl">
            Credit priced by the market,
            <br />
            not by a formula.
          </h1>
          <p className="max-w-2xl text-base">
            Montane Swap lets anyone issue debt notes, trade them on a fully onchain order book,
            and bet on their price. Each borrower&apos;s health is marked to the market price
            after every fill.
          </p>
          <div className="flex flex-wrap gap-2">
            {["Onchain CLOB", "No external oracle", "24h cells", "Live on Monad testnet"].map((x) => (
              <span
                key={x}
                className="rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-700 dark:border-white/15 dark:text-zinc-300"
              >
                {x}
              </span>
            ))}
          </div>
        </header>

        <Section id="problem" title="The problem">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["Pools, not markets", "Onchain borrowing means a shared pool with a rate set by a utilization curve."],
              ["Oracle-judged risk", "Liquidations depend on an external price feed the borrower doesn't control."],
              ["No paper of your own", "You can't issue your own debt, and nobody can price it on a real book."],
            ].map(([t, d]) => (
              <div key={t} className={card}>
                <p className="font-medium text-zinc-950 dark:text-white">{t}</p>
                <p className="mt-1 text-xs leading-5">{d}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="how" title="How it works">
          <ol className="grid gap-3 sm:grid-cols-2">
            {steps.map((s) => (
              <li key={s.n} className={`${card} flex gap-4`}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-sm font-semibold text-white dark:bg-white dark:text-[#0B0F14]">
                  {s.n}
                </span>
                <div>
                  <p className="font-medium text-zinc-950 dark:text-white">{s.t}</p>
                  <p className="mt-1 text-xs leading-5">{s.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="health" title="Health, priced live">
          <div className={`${card} text-center`}>
            <p className="font-mono text-2xl text-zinc-950 dark:text-white sm:text-3xl">
              H = G / (F × P<sub>mid</sub>)
            </p>
            <p className="mt-2 text-xs">
              G = collateral · F = notes owed · P<sub>mid</sub> = mMonad price = (last long fill + last
              short fill) / 2
            </p>
          </div>
          <p>
            The issuer owes notes. When buyers want notes, the price rises and the debt gets more
            expensive, so health falls. When shorts push the price down, health recovers. The
            borrower feels every trade, like real credit.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-xs">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Example cell: G = 115, F = 100</th>
                  <th className="py-2 pr-4 font-medium">P_mid</th>
                  <th className="py-2 pr-4 font-medium">H</th>
                  <th className="py-2 font-medium">Season</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-white/10">
                {[
                  ["Calm market", "1.00", "1.15", "Verdant"],
                  ["Longs buy aggressively", "1.06", "1.08", "Frostbite"],
                  ["Shorts push back", "1.02", "1.13", "Verdant"],
                ].map(([s, p, h, season]) => (
                  <tr key={s}>
                    <td className="py-2 pr-4">{s}</td>
                    <td className="py-2 pr-4 font-mono">{p}</td>
                    <td className="py-2 pr-4 font-mono">{h}</td>
                    <td className={`py-2 font-medium ${season === "Verdant" ? "text-[#22C55E]" : "text-[#E11D48]"}`}>
                      {season}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-zinc-500">
            Verdant: H &gt; 1.10. Frostbite: H ≤ 1.10. Mint itself requires G/F ≥ 1.10, so every note
            starts fully backed at par.
          </p>
        </Section>

        <Section id="lifecycle" title="Life of a cell">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className={card}>
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">0h</p>
              <p className="mt-1 font-medium text-zinc-950 dark:text-white">Mint</p>
              <p className="mt-1 text-xs leading-5">
                Notes are listed as a long ask at 1.005. A Season market opens for the cell.
              </p>
            </div>
            <div className={card}>
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">0–24h</p>
              <p className="mt-1 font-medium text-zinc-950 dark:text-white">Trade</p>
              <p className="mt-1 text-xs leading-5">
                Longs and shorts move the price and the health. Hunters can lock a bond on a
                Frostbite cell.
              </p>
            </div>
            <div className={card}>
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">24h+</p>
              <p className="mt-1 font-medium text-zinc-950 dark:text-white">Settle</p>
              <p className="mt-1 text-xs leading-5">
                <span className="text-[#22C55E]">Verdant</span>: the issuer repays and holders redeem
                at par. <span className="text-[#E11D48]">Frostbite</span>: a hunter takes over and
                the cell is recapitalized.
              </p>
            </div>
          </div>
          <p className="text-xs text-zinc-500">
            The 24h clock starts at the first sale (else at mint). Note holders are paid at par in
            both outcomes, pro-rata only if the cell is underwater.
          </p>
        </Section>

        <Section id="roles" title="Who uses it">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {roles.map((r) => (
              <div key={r.t} className={card}>
                <p className="font-medium text-zinc-950 dark:text-white">{r.t}</p>
                <p className="mt-1 text-xs leading-5">{r.w}</p>
                <p className="mt-2 text-xs leading-5 text-zinc-900 dark:text-zinc-200">{r.e}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="revenue" title="Revenue">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-xs">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Source</th>
                  <th className="py-2 pr-4 font-medium">Protocol takes</th>
                  <th className="py-2 font-medium">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-white/10">
                {revenue.map(([s, f, n]) => (
                  <tr key={s}>
                    <td className={`py-2 pr-4 ${strong}`}>{s}</td>
                    <td className="py-2 pr-4 font-mono">{f}</td>
                    <td className="py-2">{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-zinc-500">All fees are collected onchain into the treasury.</p>
        </Section>

        <Section id="monad" title="Why Monad">
          <p>
            A real order book matches every order onchain: placing, filling, cancelling, and
            re-marking every cell&apos;s health after each fill. On a slow or expensive chain that
            forces an offchain matching engine. Monad&apos;s fast, cheap blocks let the whole book
            live onchain, with no operator in the middle.
          </p>
        </Section>

        <Section id="safety" title="Safety rails">
          <div className="space-y-2">
            {rails.map(([t, d]) => (
              <div key={t} className={`${card} flex flex-col gap-1 sm:flex-row sm:gap-4`}>
                <p className={`shrink-0 sm:w-36 ${strong}`}>{t}</p>
                <p className="text-xs leading-5">{d}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="reference" title="Reference">
          <p className="text-xs text-zinc-500">
            Full rules for each part of the protocol. Click to expand.
          </p>

          <Ref title="Issue a cell">
            <p>
              Anyone with USDC can mint. Mint requires G/F ≥ 1.10 so every note stays backed at
              par. First mint fee is <strong>25 bps</strong>. If you repaid and remint within 48h,
              the fee is <strong>1 bp</strong> (roll).
            </p>
            <p>
              On mint the cell&apos;s notes (mMonad id = cell id) are escrowed in the market and
              listed as a <strong>long ask at 1.005</strong> for the full face. The short book
              starts empty.
            </p>
            <p>
              <strong>Retire:</strong> before maturity the issuer can buy notes back on the long book
              and burn them. Face F shrinks and H rises.
            </p>
          </Ref>

          <Ref title="Long book and the mMonad price">
            <p>
              Books are <strong>long</strong> and <strong>short</strong>. Buying long is not selling
              short; the books never cross. Fills happen at the maker&apos;s price. Taker fee is{" "}
              <strong>5 bps</strong>. The long book trades real notes of one cell; orders only match
              within the same cell.
            </p>
            <p>
              <strong>P_mid</strong> is the average of the last long fill and the last short fill,
              across all cells. Every qualifying trade moves it, and with it every cell&apos;s H.
            </p>
          </Ref>

          <Ref title="Short book (cash-settled)">
            <p>
              The short book is a cash-settled bet on a cell&apos;s note price, quoted as a price e
              below 1.00. Every unit locks exactly 1 USDC: the short puts in 1 − e, the writer puts
              in e.
            </p>
            <p>
              At maturity the settlement price v is the cell&apos;s note TWAP, capped at 1.00. On a
              thin book (under 3 fills or under 10% of face traded) v is the cell&apos;s redemption
              value instead. The short receives 1 − v and the writer v, so the short profits when
              notes trade below e. Holding both sides of one cell nets out at 1 USDC per unit, which
              is the early exit.
            </p>
            <p>
              Short trades never touch G, F or the notes. Open short units per cell are capped at
              half the cell&apos;s face.
            </p>
          </Ref>

          <Ref title="Price band: UI today, contract on mainnet">
            <p id="price-band" className="scroll-mt-24">
              The spread rule gives each book only one edge. Longs have a floor but no ceiling,
              shorts have a ceiling but no floor. Without a cap, one order could jump the price:
              with mMonad at 2.00, a long bid at 50 could print 50, collapse every cell&apos;s H and
              decide Season outcomes in a single trade.
            </p>
            <p>
              The trade desk applies a <strong>±20% band</strong>: long orders up to last long +
              20%, short orders down to last short − 20%. Prices can still trend over several
              trades; the band removes the one-shot jump.
            </p>
            <p>
              <strong>Testnet limitation:</strong> the band lives in the frontend only. The deployed{" "}
              <code className="font-mono text-xs">CreditMarket</code> enforces just the 0.10 spread,
              so a direct contract call can bypass it. We kept the testnet bytecode frozen during
              the hackathon.
            </p>
            <p>
              <strong>Mainnet:</strong> the check moves into{" "}
              <code className="font-mono text-xs">placeOrder</code> and{" "}
              <code className="font-mono text-xs">fillOrder</code> next to{" "}
              <code className="font-mono text-xs">_inSpread</code>, with a{" "}
              <code className="font-mono text-xs">PriceOutOfBand</code> error and a configurable
              width. The reference stays the last print, which already ignores fills under 1% of
              face.
            </p>
          </Ref>

          <Ref title="24h maturity">
            <p>
              The clock starts at <strong>first sale</strong> (else mint) + 24 hours, plus a minimum
              block delay. Until then the issuer cannot repay and holders cannot redeem. After it,
              any holder can redeem notes at par straight from the cell (pro-rata if H &lt; 1), and
              the short book settles. The Cell page shows a live countdown.
            </p>
          </Ref>

          <Ref title="Hunt and novation">
            <p>
              Hunting is Frostbite-only (H ≤ 1.10). Before maturity it is a{" "}
              <strong>request that locks bond B</strong>. At maturity: if the cell recovered to
              Verdant, the bond is slashed to the issuer; if still Frostbite, the cell novates to
              the hunter. After maturity a hunter can novate at once.
            </p>
            <p>
              On novation the bond is added to the cell&apos;s collateral and the hunter takes the
              issuer seat, including unsold notes. The previous issuer loses their margin. Note
              holders are unaffected; the cell is now better collateralized. One wallet can be the
              issuer of only one active cell.
            </p>
          </Ref>

          <Ref title="Repay">
            <p>
              Issuer-only, Verdant (H &gt; 1.10), after maturity. Repay reserves 1 USDC for every
              outstanding note (or all of G if less), fixes the short-book settlement price,
              refunds resting orders and returns the rest of the collateral to the issuer. Every
              holder then redeems their notes at par from Portfolio.
            </p>
          </Ref>

          <Ref title="Season">
            <p>
              An optional market bound to one cell. For the first 12h after the cell opens, buy only
              VERDANT or only FROSTBITE at $1. Hedge packs (equal V + F) stay open until maturity.
            </p>
            <p>
              At maturity <strong>VERDANT</strong> wins if the cell&apos;s marked H is above 1.10;
              otherwise <strong>FROSTBITE</strong> wins. The settling P_mid and H are stored onchain.
              The losing pot splits 10% treasury, 10% issuer, 80% winners. With no losers, everyone
              gets 1:1 back.
            </p>
            <p>
              Because P_mid moves with every fill, a Season is a live contest: long buyers push
              cells toward Frostbite, shorts push them back to Verdant. Anyone who thinks the price
              is wrong can trade against it.
            </p>
          </Ref>

          <Ref title="Portfolio">
            <p>
              <Link href="/portfolio" className="font-medium underline-offset-2 hover:underline">
                Portfolio
              </Link>{" "}
              shows your USDC and mMonad marked to market, issued debt, cells where you are issuer
              or holder (with marked H), notes to redeem, resting orders, short positions with
              settle and claim, and Season positions with cost, mark and PnL.
            </p>
          </Ref>
        </Section>

        <Section id="glossary" title="Glossary">
          <dl className="grid gap-3 sm:grid-cols-2">
            {[
              [
                "mMonad",
                "The debt note: an ERC-1155 where token id = cell id, so notes of different cells never mix. Each is a claim on 1 USDC of that cell at maturity. Not the Monad gas token.",
              ],
              ["Cell", "One issuer position: collateral G and face F (= mMonad supply of that id)."],
              ["Verdant", "Healthy cell: marked H > 1.10."],
              ["Frostbite", "Stressed cell: marked H ≤ 1.10. Hunting opens; repay is blocked."],
              ["P_mid", "The mMonad price: (last long fill + last short fill) / 2, one price for all cells."],
              ["Note TWAP", "Time-weighted long-note price of a cell; settles its short book."],
              ["Novation", "A hunter takes over a Frostbite cell by adding a bond to its collateral."],
              ["Retire", "Issuer buys notes back and burns them, shrinking F before maturity."],
              ["Redeem", "Holders burn notes for USDC at par after repay or maturity."],
            ].map(([k, v]) => (
              <div key={k} className={card}>
                <dt className="font-medium text-zinc-950 dark:text-white">{k}</dt>
                <dd className="mt-1 text-xs leading-5">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </article>
    </div>
  );
}
