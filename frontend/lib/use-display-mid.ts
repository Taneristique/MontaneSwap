"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { creditMarketAbi } from "./abi";
import { fromWad } from "./format";
import { monadTestnet } from "./wagmi";
import type { Address } from "viem";

/** Minimum distance between the long and short books (LONG_SHORT_GAP on-chain). */
export const LONG_SHORT_GAP = 10n ** 17n;

/**
 * P_mid is the on-chain mMonad mark: (last long fill + last short fill) / 2.
 * Every cell's health is marked against it: H = G / (F × P_mid).
 */
export function useDisplayMid(market?: Address, lastTradePx?: bigint) {
  const reads = useReadContracts({
    contracts: (["pMid", "lastLongPx", "lastShortPx"] as const).map((functionName) => ({
      address: market,
      abi: creditMarketAbi,
      functionName,
      chainId: monadTestnet.id,
    })),
    query: {
      enabled: Boolean(market),
      refetchInterval: 3000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  });

  const derived = useMemo(() => {
    const [mid, long, short] = (reads.data ?? []).map((r) =>
      r.status === "success" ? (r.result as bigint) : 0n,
    );
    const px = mid && mid > 0n ? mid : 10n ** 18n;
    const lastLong = long ?? 0n;
    const lastShort = short ?? 0n;
    return {
      px,
      markPx: px,
      label: fromWad(px),
      markLabel: fromWad(px),
      source: "chain" as const,
      markSource: "last long + last short" as const,
      chainLabel: mid ? fromWad(mid) : "—",
      lastLabel: lastTradePx && lastTradePx > 0n ? fromWad(lastTradePx) : null,
      lastLong,
      lastShort,
      /** Lowest price a long order may carry. */
      longFloor: lastShort > 0n ? lastShort + LONG_SHORT_GAP : 0n,
      /** Highest price a short order may carry. */
      shortCap: lastLong > LONG_SHORT_GAP ? lastLong - LONG_SHORT_GAP : 0n,
    };
  }, [reads.data, lastTradePx]);

  return { ...derived, loading: reads.isLoading };
}

/** Marked health: G / (F × P_mid) — the same formula as on-chain health(). */
export function markHealth(collateral: bigint, debt: bigint, pMid: bigint) {
  if (debt === 0n || pMid === 0n) return 0n;
  return (collateral * 10n ** 18n * 10n ** 18n) / (debt * pMid);
}
