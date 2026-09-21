"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { managerAbi } from "@/lib/abi";
import { SWAP } from "@/lib/addresses";
import { ensureAllowance } from "@/lib/ensure-usdc";
import { toWad } from "@/lib/format";
import { getTxClients } from "@/lib/tx-clients";
import { txError } from "@/lib/tx-error";
import { useProtocol } from "@/lib/use-protocol";

export default function IssuePage() {
  const [g, setG] = useState("111.25");
  const [f, setF] = useState("100");
  const [roll, setRoll] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { isConnected } = useAccount();
  const protocol = useProtocol();

  const math = useMemo(() => {
    const G = Number(g);
    const F = Number(f);
    if (!G || !F || F <= 0) return null;
    const fee = F * (roll ? 0.0001 : 0.0025);
    const net = G - fee;
    const h = net / F;
    return { fee, net, h };
  }, [g, f, roll]);

  async function mint() {
    if (!isConnected) {
      setNote("Connect a wallet on Monad testnet.");
      return;
    }
    if (!SWAP) {
      setNote("NEXT_PUBLIC_SWAP is missing. Check frontend/.env.local and restart pnpm dev.");
      return;
    }
    if (!protocol.ready) {
      setNote(
        protocol.error
          ? `Protocol not loaded: ${protocol.error.message}`
          : "Loading protocol from chain… switch MetaMask to Monad testnet (10143) and retry.",
      );
      return;
    }
    const debt = toWad(f);
    const usdcIn = toWad(g);
    setBusy(true);
    setNote(null);
    try {
      const { publicClient, wallet, address } = await getTxClients();
      await ensureAllowance({
        publicClient,
        wallet,
        token: protocol.usdc!,
        owner: address,
        spender: protocol.manager!,
        need: usdcIn,
      });
      const hash = await wallet.writeContract({
        address: protocol.manager!,
        abi: managerAbi,
        functionName: "createCDP",
        args: [debt, usdcIn],
      });
      const rec = await publicClient.waitForTransactionReceipt({ hash });
      setNote(`Minted. Seeded long 1.005 and short 0.995. ${rec.transactionHash}`);
    } catch (e) {
      setNote(txError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">Issue</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Anyone with USDC can mint. Default is Verdant (H over 1.10). First
          mint 25 bps (0.25%). Roll within 48h: 1 bp (0.01%). Seed spread 50
          bps (1.005 / 0.995). This calls createCDP on-chain.
        </p>
      </div>
      {!SWAP && (
        <p className="text-xs text-[#E11D48]">
          Set NEXT_PUBLIC_SWAP. Deploy with contracts/script/Deploy.s.sol.
        </p>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={roll}
          onChange={(e) => setRoll(e.target.checked)}
          className="size-4 accent-zinc-900 dark:accent-zinc-100"
        />
        <span className="text-zinc-600 dark:text-zinc-400">
          Roll (repay was within 48h) — fee preview only; the contract decides.
        </span>
      </label>
      <label className="flex flex-col gap-2 text-sm">
        <span className="text-zinc-500">USDC in</span>
        <input
          value={g}
          onChange={(e) => setG(e.target.value)}
          className="min-h-11 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-base font-mono outline-none focus:border-zinc-400 dark:border-white/10 dark:bg-white/5"
        />
      </label>
      <label className="flex flex-col gap-2 text-sm">
        <span className="text-zinc-500">Face (mMonad)</span>
        <input
          value={f}
          onChange={(e) => setF(e.target.value)}
          className="min-h-11 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-base font-mono outline-none focus:border-zinc-400 dark:border-white/10 dark:bg-white/5"
        />
      </label>
      {math && (
        <dl className="grid grid-cols-2 gap-3 rounded-2xl border border-zinc-200 bg-white p-4 text-sm dark:border-white/10 dark:bg-transparent">
          <dt className="text-zinc-500">Fee</dt>
          <dd className="text-right font-mono">{math.fee.toFixed(4)} USDC</dd>
          <dt className="text-zinc-500">Collateral left</dt>
          <dd className="text-right font-mono">{math.net.toFixed(4)}</dd>
          <dt className="text-zinc-500">HealthRatio</dt>
          <dd className="text-right font-mono">{math.h.toFixed(4)}</dd>
          <dt className="text-zinc-500">Season</dt>
          <dd className="text-right">
            {math.h <= 1.1 ? (
              <span className="text-[#E11D48]">Frostbite</span>
            ) : (
              <span className="text-[#22C55E]">Verdant</span>
            )}
          </dd>
        </dl>
      )}
      {note && (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">{note}</p>
      )}
      <button
        type="button"
        disabled={!math || busy || !SWAP}
        onClick={() => void mint()}
        className="min-h-12 rounded-full bg-zinc-950 py-3 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-[#0B0F14]"
      >
        {busy ? "Sending…" : "Mint · seed book"}
      </button>
    </div>
  );
}
