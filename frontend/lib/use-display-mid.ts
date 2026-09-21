"use client";

import { useMemo } from "react";
import { useReadContract } from "wagmi";
import { creditMarketAbi, Side } from "./abi";
import { fromWad } from "./format";
import { monadTestnet } from "./wagmi";
import type { Address } from "viem";

type Live = {
  id: bigint;
  maker: Address;
  cdpId: bigint;
  side: number;
  price: bigint;
  remaining: bigint;
  fomo: boolean;
  landedAt: bigint;
};

/**
 * displayPx / markPx — live long book first, then last trade, then chain.
 * Never let a stale print (e.g. 1.48) override a live ask at 1.005.
 */
export function useDisplayMid(market?: Address, lastTradePx?: bigint) {
  const chainMid = useReadContract({
    address: market,
    abi: creditMarketAbi,
    functionName: "pMid",
    chainId: monadTestnet.id,
    query: {
      enabled: Boolean(market),
      refetchInterval: 3000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  });
  const live = useReadContract({
    address: market,
    abi: creditMarketAbi,
    functionName: "liveBook",
    chainId: monadTestnet.id,
    query: {
      enabled: Boolean(market),
      refetchInterval: 3000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  });

  const book = (live.data ?? []) as Live[];

  const derived = useMemo(() => {
    let bestLongAsk = 0n;
    let bestLongBid = 0n;
    let bestShortAsk = 0n;
    let bestShortBid = 0n;
    for (const o of book) {
      if (o.remaining === 0n) continue;
      if (o.side === Side.LongAsk && (bestLongAsk === 0n || o.price < bestLongAsk)) {
        bestLongAsk = o.price;
      }
      if (o.side === Side.LongBid && o.price > bestLongBid) bestLongBid = o.price;
      if (o.side === Side.ShortAsk && (bestShortAsk === 0n || o.price < bestShortAsk)) {
        bestShortAsk = o.price;
      }
      if (o.side === Side.ShortBid && o.price > bestShortBid) bestShortBid = o.price;
    }

    const par = 10n ** 18n;
    const chain = chainMid.data && chainMid.data > 0n ? chainMid.data : par;

    let source: "long" | "cross" | "last" | "ask" | "bid" | "chain" = "chain";
    let px = chain;

    if (bestLongAsk > 0n && bestLongBid > 0n) {
      px = (bestLongAsk + bestLongBid) / 2n;
      source = "long";
    } else if (bestLongAsk > 0n) {
      px = bestLongAsk;
      source = "ask";
    } else if (bestLongBid > 0n && bestShortBid > 0n) {
      px = (bestLongBid + bestShortBid) / 2n;
      source = "cross";
    } else if (bestLongBid > 0n) {
      px = bestLongBid;
      source = "bid";
    } else if (lastTradePx && lastTradePx > 0n) {
      px = lastTradePx;
      source = "last";
    }

    // H@mark tracks the same live mark as P_mid (book > last).
    const markPx = px;
    const markSource = source;

    return {
      px,
      markPx,
      label: fromWad(px),
      markLabel: fromWad(markPx),
      source,
      markSource,
      chainLabel: chainMid.data != null ? fromWad(chainMid.data) : "—",
      lastLabel: lastTradePx && lastTradePx > 0n ? fromWad(lastTradePx) : null,
      bestLongAsk,
      bestLongBid,
      bestShortAsk,
      bestShortBid,
    };
  }, [book, chainMid.data, lastTradePx]);

  return {
    ...derived,
    loading: chainMid.isLoading || live.isLoading,
  };
}

/** Mark health: G / (F × P_mark). On-chain health() is G/F only. */
export function markHealth(collateral: bigint, debt: bigint, pMid: bigint) {
  if (debt === 0n || pMid === 0n) return 0n;
  return (collateral * 10n ** 18n * 10n ** 18n) / (debt * pMid);
}
