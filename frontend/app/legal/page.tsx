import Link from "next/link";

const toc = [
  { href: "#terms", label: "Terms of Service" },
  { href: "#disclaimer", label: "Risk & disclaimer" },
  { href: "#no-advice", label: "No financial advice" },
  { href: "#eligibility", label: "Eligibility" },
  { href: "#software", label: "Software as-is" },
  { href: "#ip", label: "Intellectual property" },
  { href: "#contact", label: "Contact" },
];

export default function LegalPage() {
  return (
    <div className="flex flex-col gap-10 lg:flex-row lg:gap-12">
      <aside className="lg:w-52 lg:shrink-0">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
          Legal
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
            Legal
          </h1>
          <p className="mt-3 max-w-2xl">
            Last updated: 20 September 2026. These terms govern your use of the Montane
            Swap interface and related smart contracts published in connection with ZKCTF /
            MontaneSwap. By accessing the app you agree to this page.
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            © 2026 ZKCTF. All rights reserved by MontaneSwap.
          </p>
        </header>

        <section id="terms" className="scroll-mt-24 space-y-3">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-white">
            Terms of Service
          </h2>
          <p>
            Montane Swap is an experimental, non-custodial interface to open-source smart
            contracts on Monad testnet (and any networks we later support). You interact
            directly with the blockchain through your own wallet. We do not hold your keys,
            custody your assets, or execute trades on your behalf.
          </p>
          <p>
            You are solely responsible for wallet security, transaction review, gas fees,
            slippage, and any irreversible on-chain outcomes. If you do not understand the
            protocol, do not use it.
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>You must comply with all laws that apply to you.</li>
            <li>You must not use the interface for unlawful, fraudulent, or abusive activity.</li>
            <li>We may modify, pause, or discontinue the interface at any time without notice.</li>
            <li>
              Smart contracts may be upgraded, redeployed, or deprecated; addresses in the UI
              may change.
            </li>
          </ul>
        </section>

        <section id="disclaimer" className="scroll-mt-24 space-y-3">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-white">
            Risk & disclaimer
          </h2>
          <p>
            Digital assets and DeFi protocols involve substantial risk of loss, including
            total loss of funds. Risks include but are not limited to: smart-contract bugs,
            oracle or mid-price divergence, liquidation / hunt / novation, market
            illiquidity, key compromise, phishing, RPC failure, and regulatory change.
          </p>
          <p>
            Testnet tokens have no guaranteed value. Mainnet use (if any) remains experimental.
            Past demos or simulations are not performance guarantees.
          </p>
        </section>

        <section id="no-advice" className="scroll-mt-24 space-y-3">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-white">
            No financial, legal, or tax advice
          </h2>
          <p>
            Nothing on this site, in the docs, or in related materials constitutes investment,
            legal, tax, or accounting advice. Content is for educational and informational
            purposes only. You should obtain professional advice before making decisions.
          </p>
        </section>

        <section id="eligibility" className="scroll-mt-24 space-y-3">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-white">
            Eligibility & sanctions
          </h2>
          <p>
            You represent that you are not prohibited from using blockchain software under
            the laws of your jurisdiction, and that you are not on any applicable sanctions
            list. The interface is not directed to persons where such use would be illegal.
          </p>
        </section>

        <section id="software" className="scroll-mt-24 space-y-3">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-white">
            Software provided “as is”
          </h2>
          <p>
            THE INTERFACE AND CONTRACTS ARE PROVIDED “AS IS” AND “AS AVAILABLE,” WITHOUT
            WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS
            FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. TO THE MAXIMUM EXTENT PERMITTED
            BY LAW, ZKCTF, MONTANESWAP, AND CONTRIBUTORS SHALL NOT BE LIABLE FOR ANY INDIRECT,
            INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF FUNDS,
            DATA, OR PROFITS, ARISING FROM YOUR USE OF THE SOFTWARE.
          </p>
          <p>
            Aggregate liability, if any cannot be excluded, is limited to one hundred US
            dollars (USD $100) or the amount you paid us for access to the interface in the
            prior twelve months (typically zero).
          </p>
        </section>

        <section id="ip" className="scroll-mt-24 space-y-3">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-white">
            Intellectual property
          </h2>
          <p>
            Branding, UI, and documentation are © 2026 ZKCTF / MontaneSwap unless otherwise
            noted. Third-party marks (including wallet and chain brands) belong to their
            owners. Source code licensing, if published, is stated in the relevant repository.
          </p>
        </section>

        <section id="contact" className="scroll-mt-24 space-y-3">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-white">Contact</h2>
          <p>
            Project presence:{" "}
            <a
              href="https://github.com/Taneristique"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline-offset-2 hover:underline"
            >
              github.com/Taneristique
            </a>
            . For security issues, prefer responsible disclosure via the GitHub profile or
            channels listed in the repository when available.
          </p>
          <p className="text-xs text-zinc-500">
            This page is a protective notice for an experimental hackathon / research
            interface. It is not a substitute for counsel in your jurisdiction.
          </p>
          <p>
            <Link href="/" className="underline-offset-2 hover:underline">
              ← Back home
            </Link>
          </p>
        </section>
      </article>
    </div>
  );
}
