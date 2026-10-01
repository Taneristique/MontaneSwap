"use client";

import { TradeDesk } from "@/components/TradeDesk";
import { creditMarketAbi } from "@/lib/abi";
import { SWAP } from "@/lib/addresses";
import { fromWad } from "@/lib/format";
import { useDisplayMid } from "@/lib/use-display-mid";
import { useFillTape } from "@/lib/use-fill-tape";
import { useProtocol } from "@/lib/use-protocol";
import { monadTestnet } from "@/lib/wagmi";
import { useReadContract } from "wagmi";

export default function TradePage() {
  const { market } = useProtocol();
  const tape = useFillTape(market);
  const mid = useDisplayMid(market, tape.lastPrice);
  const frozen = useReadContract({
    address: market,
    abi: creditMarketAbi,
    functionName: "frozen",
    chainId: monadTestnet.id,
    query: { enabled: Boolean(market), refetchInterval: 4000 },
  });

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Trade</h1>
          <p className="mt-2 max-w-lg text-sm text-zinc-600 dark:text-zinc-400">
            P<sub>mid</sub> is the mMonad price: the average of the last long fill and the last
            short fill. Every cell is marked against it, H = G / (F × P<sub>mid</sub>). Long buys
            push H down toward Frostbite, and shorts push it back up. Long orders stay at least
            0.10 above the last short.
          </p>
        </div>
        <div className="flex w-fit flex-col gap-1 rounded-2xl border border-zinc-200 px-4 py-2 font-mono text-sm dark:border-white/10">
          <div>
            P<sub>mid</sub> {SWAP ? mid.label : "—"}
            <span className="ml-3 text-zinc-500">
              {frozen.data ? "frozen" : "open"}
            </span>
          </div>
          <div className="text-[11px] text-zinc-500">
            last long {mid.lastLong > 0n ? fromWad(mid.lastLong) : "—"} · last short{" "}
            {mid.lastShort > 0n ? fromWad(mid.lastShort) : "—"}
          </div>
          <div className="text-[11px] text-zinc-500">
            long ≥ {mid.longFloor > 0n ? fromWad(mid.longFloor) : "—"} · short ≤{" "}
            {mid.shortCap > 0n ? fromWad(mid.shortCap) : "—"}
          </div>
        </div>
      </div>
      <TradeDesk fillTape={tape} />
    </div>
  );
}
