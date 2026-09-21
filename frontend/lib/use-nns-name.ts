"use client";

import { type Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { nnsAbi } from "./abi";
import { NNS } from "./addresses";
import { shortAddr } from "./format";

export function useNnsName(address?: Address) {
  const { data } = useReadContract({
    address: NNS,
    abi: nnsAbi,
    functionName: "getPrimaryNameForAddress",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });
  if (data) return `${data}.nad`;
  return address ? shortAddr(address) : "—";
}

export function useNnsNames(addresses: Address[]) {
  const unique = [...new Set(addresses.filter(Boolean))];
  const { data } = useReadContracts({
    contracts: unique.map((addr) => ({
      address: NNS,
      abi: nnsAbi,
      functionName: "getPrimaryNameForAddress" as const,
      args: [addr] as const,
    })),
    query: { enabled: unique.length > 0 },
  });
  const map = new Map<string, string>();
  unique.forEach((addr, i) => {
    const name = data?.[i]?.result;
    map.set(addr.toLowerCase(), name ? `${name}.nad` : shortAddr(addr));
  });
  return map;
}
