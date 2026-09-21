"use client";

import { useReadContract } from "wagmi";
import { SWAP } from "./addresses";
import { swapAbi, creditMarketAbi } from "./abi";
import { monadTestnet } from "./wagmi";

export function useProtocol() {
  const enabled = Boolean(SWAP);
  const chainId = monadTestnet.id;
  const poll = {
    enabled,
    refetchInterval: 8_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 3,
  } as const;
  const manager = useReadContract({
    address: SWAP,
    abi: swapAbi,
    functionName: "manager",
    chainId,
    query: poll,
  });
  const position = useReadContract({
    address: SWAP,
    abi: swapAbi,
    functionName: "position",
    chainId,
    query: poll,
  });
  const market = useReadContract({
    address: SWAP,
    abi: swapAbi,
    functionName: "market",
    chainId,
    query: poll,
  });
  const token = useReadContract({
    address: SWAP,
    abi: swapAbi,
    functionName: "token",
    chainId,
    query: poll,
  });
  const usdc = useReadContract({
    address: market.data,
    abi: creditMarketAbi,
    functionName: "usdc",
    chainId,
    query: {
      enabled: Boolean(market.data),
      refetchInterval: 8_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 3,
    },
  });

  const error =
    manager.error ?? position.error ?? market.error ?? token.error ?? usdc.error;

  return {
    swap: SWAP,
    manager: manager.data,
    position: position.data,
    market: market.data,
    token: token.data,
    usdc: usdc.data,
    ready: Boolean(SWAP && manager.data && market.data && token.data && usdc.data && position.data),
    loading: enabled && (!manager.data || !market.data),
    error,
  };
}
