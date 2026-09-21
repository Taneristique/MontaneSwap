import {
  getAccount,
  getPublicClient,
  getWalletClient,
  switchChain,
} from "wagmi/actions";
import { monadTestnet, wagmiConfig } from "./wagmi";

/** Resolve viem clients at click-time. Hooks often stay undefined when the
 *  connector chain ≠ configured chain (RainbowKit connected, wallet client null). */
export async function getTxClients() {
  const account = getAccount(wagmiConfig);
  if (!account.isConnected || !account.address) {
    throw new Error("Connect a wallet on Monad testnet (10143).");
  }

  if (account.chainId !== monadTestnet.id) {
    await switchChain(wagmiConfig, { chainId: monadTestnet.id });
  }

  const publicClient = getPublicClient(wagmiConfig, {
    chainId: monadTestnet.id,
  });
  if (!publicClient) {
    throw new Error("Monad testnet RPC client missing.");
  }

  const wallet = await getWalletClient(wagmiConfig, {
    chainId: monadTestnet.id,
    account: account.address,
  });
  if (!wallet) {
    throw new Error(
      "Wallet client unavailable after switch. Reconnect MetaMask on Monad testnet (10143).",
    );
  }

  // Prefer the address the wallet will actually sign with (avoids stale wagmi session).
  const address = wallet.account?.address ?? account.address;
  if (address.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(
      `Wallet account mismatch (${account.address} vs ${address}). Disconnect and reconnect.`,
    );
  }

  return { publicClient, wallet, address };
}
