import Link from "next/link";
import { Connect } from "@/components/Connect";
import { Faucet } from "@/components/Faucet";

const USDC = "0xb5fd0160056cEBFe59B86FB95A4a6c48ad7E642f";

const steps = [
  {
    t: "Add Monad testnet",
    d: (
      <>
        Chain <code className="font-mono text-xs">10143</code>, RPC{" "}
        <code className="font-mono text-xs">https://testnet-rpc.monad.xyz</code>. Connecting
        below offers to switch networks for you.
      </>
    ),
  },
  {
    t: "Get gas MON",
    d: (
      <>
        Every transaction needs a little testnet MON. Claim some from the{" "}
        <a
          href="https://faucet.monad.xyz"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-zinc-950 dark:hover:text-white"
        >
          Monad faucet
        </a>
        .
      </>
    ),
  },
  {
    t: "Mint test USDC",
    d: "Each click mints 1,000 MockUSDC to your connected wallet. Click again if you need more.",
  },
  {
    t: "Try the protocol",
    d: (
      <>
        <Link href="/trade" className="underline underline-offset-2">Trade</Link> notes or open
        a short, <Link href="/issue" className="underline underline-offset-2">issue</Link> your
        own cell (one per wallet), or bet on a{" "}
        <Link href="/season" className="underline underline-offset-2">Season</Link>.
      </>
    ),
  },
];

export default function FaucetPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8 text-sm leading-7 text-zinc-600 dark:text-zinc-400">
      <header>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">Faucet</p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-950 dark:text-white sm:text-3xl">
          Get test USDC
        </h1>
        <p className="mt-3">
          Montane Swap runs on Monad testnet with MockUSDC as collateral. It has no value and
          anyone can mint it, so you can try every part of the app for free.
        </p>
      </header>

      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li
            key={s.t}
            className="flex gap-4 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-xs font-semibold text-white dark:bg-white dark:text-[#0B0F14]">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="font-medium text-zinc-950 dark:text-white">{s.t}</p>
              <p className="mt-1 text-xs leading-5">{s.d}</p>
              {i === 2 && (
                <div className="mt-3">
                  <Faucet fallback={<Connect />} />
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>

      <p className="text-xs text-zinc-500">
        MockUSDC:{" "}
        <a
          href={`https://testnet.monadvision.com/address/${USDC}`}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all font-mono underline-offset-2 hover:underline"
        >
          {USDC}
        </a>
        . Add it to your wallet as a custom token (18 decimals) to see your balance.
      </p>
    </div>
  );
}
