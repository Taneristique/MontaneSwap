"use client";

import { useCallback, useEffect, useState } from "react";
import { type Address } from "viem";
import { useWatchContractEvent } from "wagmi";
import { creditMarketAbi } from "./abi";
import { TAPE_SEED } from "./tape-seed";
import { monadTestnet } from "./wagmi";

export type FillTape = {
  orderId: bigint;
  taker: Address;
  amount: bigint;
  payUsdc: bigint;
  price: bigint;
  blockNumber: bigint;
  timestampSec: bigint;
  txHash: `0x${string}`;
  logIndex: number;
};

type ApiFill = {
  orderId: string;
  taker: Address;
  amount: string;
  payUsdc: string;
  price: string;
  blockNumber: string;
  timestampSec: string;
  txHash: `0x${string}`;
  logIndex: number;
};

function fromApi(f: ApiFill): FillTape {
  return {
    orderId: BigInt(f.orderId),
    taker: f.taker,
    amount: BigInt(f.amount),
    payUsdc: BigInt(f.payUsdc),
    price: BigInt(f.price),
    blockNumber: BigInt(f.blockNumber),
    timestampSec: BigInt(f.timestampSec),
    txHash: f.txHash,
    logIndex: f.logIndex,
  };
}

function merge(prev: FillTape[], next: FillTape[]) {
  const map = new Map<string, FillTape>();
  for (const f of [...next, ...prev]) {
    map.set(`${f.txHash}-${f.logIndex}`, f);
  }
  return [...map.values()]
    .sort((a, b) => {
      if (a.blockNumber === b.blockNumber) return b.logIndex - a.logIndex;
      return Number(b.blockNumber - a.blockNumber);
    })
    .slice(0, 120);
}

/** Polls server /api/tape so desktop + phone share the same fill history (RPC getLogs is flaky on mobile). */
export function useFillTape(market?: Address, _taker?: Address) {
  const [fills, setFills] = useState<FillTape[]>(() => TAPE_SEED.map(fromApi));
  const [loading, setLoading] = useState(false);
  const [tradeCount, setTradeCount] = useState(TAPE_SEED.length);
  const [fetchedAt, setFetchedAt] = useState(0);

  const refetch = useCallback(async (force = false) => {
    if (!market) return;
    setLoading(true);
    const ctrl = new AbortController();
    const kill = window.setTimeout(() => ctrl.abort(), 8_000);
    try {
      const res = await fetch(`/api/tape${force ? "?force=1" : ""}`, {
        cache: "no-store",
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        tradeCount: number;
        fills: ApiFill[];
        fetchedAt?: number;
      };
      setTradeCount(Math.max(data.tradeCount ?? 0, TAPE_SEED.length));
      // API wins on duplicate keys; seed fills gaps when RPC scan is behind.
      setFills(merge((data.fills ?? []).map(fromApi), TAPE_SEED.map(fromApi)));
      setFetchedAt(data.fetchedAt ?? Date.now());
    } catch {
      /* keep seed / prior — phone must never go blank */
    } finally {
      window.clearTimeout(kill);
      setLoading(false);
    }
  }, [market]);

  useEffect(() => {
    void refetch(false);
    const id = window.setInterval(() => void refetch(false), 4000);
    const onVis = () => {
      if (document.visibilityState === "visible") void refetch(false);
    };
    const onFocus = () => void refetch(false);
    const onOnline = () => void refetch(false);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [refetch]);

  useWatchContractEvent({
    address: market,
    abi: creditMarketAbi,
    eventName: "Filled",
    chainId: monadTestnet.id,
    enabled: Boolean(market),
    onLogs() {
      void refetch(true);
    },
  });

  return {
    fills,
    loading,
    refetch: () => refetch(true),
    lastPrice: fills[0]?.price,
    tradeCount,
    fetchedAt,
  };
}
