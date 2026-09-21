"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { http } from "wagmi";
import { defineChain } from "viem";
import { monadTestnet as monadBase } from "viem/chains";

export const monadTestnet = defineChain({
  ...monadBase,
  contracts: {
    ...monadBase.contracts,
    ensRegistry: {
      address: "0x6A1c3156F66a276f39751cAd4146ea4Ca463EcC7",
    },
    ensUniversalResolver: {
      address: "0xE451F2AB9E5d009b7384cD3B8d0B90c71CD4d0F7",
    },
  },
});

const wcProjectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "";
const wcReady = /^[0-9a-f]{32}$/i.test(wcProjectId);
const rpc = process.env.NEXT_PUBLIC_RPC ?? monadBase.rpcUrls.default.http[0];

export const wagmiConfig = getDefaultConfig({
  appName: "Montane Swap",
  projectId: wcReady ? wcProjectId : "00000000000000000000000000000000",
  chains: [monadTestnet],
  ssr: true,
  transports: {
    [monadTestnet.id]: http(rpc, {
      timeout: 8_000,
      retryCount: 3,
      retryDelay: 250,
      batch: { wait: 16 },
    }),
  },
  wallets: [
    {
      groupName: "Montane",
      wallets: [
        injectedWallet,
        metaMaskWallet,
        rabbyWallet,
        rainbowWallet,
        ...(wcReady ? [walletConnectWallet] : []),
      ],
    },
  ],
});
