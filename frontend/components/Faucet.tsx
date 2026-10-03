"use client";

import { useState, type ReactNode } from "react";
import { parseAbi } from "viem";
import { useAccount } from "wagmi";
import { getTxClients } from "@/lib/tx-clients";
import { txError } from "@/lib/tx-error";
import { useProtocol } from "@/lib/use-protocol";
import { noRestore } from "@/lib/no-restore";

const mockUsdcAbi = parseAbi(["function mint(address to, uint256 amount)"]);
const DRIP = 1_000n * 10n ** 18n;

/** Testnet only: MockUSDC.mint is open, so anyone can top up and try the app. */
export function Faucet({ fallback = null }: { fallback?: ReactNode }) {
  const { isConnected } = useAccount();
  const protocol = useProtocol();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");

  if (!isConnected || !protocol.usdc) return <>{fallback}</>;

  async function drip() {
    setState("busy");
    try {
      const { publicClient, wallet, address } = await getTxClients();
      const hash = await wallet.writeContract({
        address: protocol.usdc!,
        abi: mockUsdcAbi,
        functionName: "mint",
        args: [address, DRIP],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setState("done");
      setTimeout(() => setState("idle"), 3000);
    } catch (e) {
      setState("idle");
      alert(txError(e));
    }
  }

  return (
    <button
      {...noRestore}
      type="button"
      disabled={state === "busy"}
      onClick={() => void drip()}
      title="Mint 1,000 test USDC to your wallet (Monad testnet)"
      className="min-h-9 shrink-0 rounded-full border border-zinc-200 px-3 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-950/5 disabled:opacity-50 dark:border-white/15 dark:text-zinc-300 dark:hover:bg-white/10"
    >
      {state === "busy" ? "Minting…" : state === "done" ? "+1,000 USDC" : "Test USDC"}
    </button>
  );
}
