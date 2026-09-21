"use client";

import { useAccountModal, useChainModal, useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId } from "wagmi";
import { monadTestnet } from "@/lib/wagmi";
import { useIsClient } from "@/lib/use-is-client";
import { useNnsName } from "@/lib/use-nns-name";

export function Connect() {
  const { openConnectModal } = useConnectModal();
  const { openAccountModal } = useAccountModal();
  const { openChainModal } = useChainModal();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const ready = useIsClient();
  const nns = useNnsName(address);

  const wrong = ready && isConnected && chainId !== monadTestnet.id;
  const label =
    !ready || !isConnected
      ? "Connect"
      : wrong
        ? "Wrong network"
        : nns;

  return (
    <button
      type="button"
      onClick={() => {
        if (!ready) return;
        if (!isConnected) openConnectModal?.();
        else if (wrong) openChainModal?.();
        else openAccountModal?.();
      }}
      className={
        wrong
          ? "rounded-full bg-[#E11D48] px-4 py-1.5 text-sm font-medium text-white"
          : "rounded-full bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white sm:px-4 sm:text-sm dark:bg-white dark:text-[#0B0F14]"
      }
    >
      {label}
    </button>
  );
}
