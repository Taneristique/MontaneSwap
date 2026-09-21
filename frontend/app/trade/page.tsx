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
            Books are long and short. HealthRatio is mark-to-market:
            G / (F × last trade or long ask). Pull-to-refresh or tap Refresh on phone.
          </p>
        </div>
        <div className="flex w-fit flex-col gap-1 rounded-2xl border border-zinc-200 px-4 py-2 font-mono text-sm dark:border-white/10">
          <div>
            P<sub>mid</sub> {SWAP ? mid.label : "—"}
            <span className="ml-2 text-[11px] text-zinc-500">{mid.source}</span>
            <span className="ml-3 text-zinc-500">
              {frozen.data ? "frozen" : "open"}
            </span>
          </div>
          <div className="text-[11px] text-zinc-500">
            mark {mid.markLabel} ({mid.markSource})
            {mid.bestLongAsk > 0n && <> · ask {fromWad(mid.bestLongAsk)}</>}
            {mid.bestLongBid > 0n && <> · bid {fromWad(mid.bestLongBid)}</>}
            {mid.lastLabel && <> · last {mid.lastLabel}</>}
          </div>
        </div>
      </div>
      <TradeDesk fillTape={tape} />
    </div>
  );
}
