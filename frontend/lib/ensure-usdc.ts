import { erc20Abi, type Address, maxUint256 } from "viem";
import type { PublicClient, WalletClient } from "viem";

const mem = new Map<string, bigint>();

function key(token: Address, owner: Address, spender: Address) {
  return `${token.toLowerCase()}:${owner.toLowerCase()}:${spender.toLowerCase()}`;
}

async function readAllowance(
  publicClient: PublicClient,
  token: Address,
  owner: Address,
  spender: Address,
) {
  return publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, spender],
    blockTag: "latest",
  });
}

/**
 * Approve `maxUint256` once when short.
 * Skips the wallet prompt when on-chain (or cached) allowance already covers `need`.
 */
export async function ensureAllowance(opts: {
  publicClient: PublicClient;
  wallet: WalletClient;
  token: Address;
  owner: Address;
  spender: Address;
  need: bigint;
}) {
  const { publicClient, wallet, token, owner, spender, need } = opts;
  if (need <= 0n) return;

  const k = key(token, owner, spender);
  const cached = mem.get(k);
  if (cached != null && cached >= need) {
    // Cheap path — still verify once in a while via fresh read below if cache is max.
    if (cached === maxUint256) return;
  }

  let have = await readAllowance(publicClient, token, owner, spender);
  mem.set(k, have);
  if (have >= need) return;

  // RPC lag: re-read once before prompting MetaMask again.
  await new Promise((r) => setTimeout(r, 400));
  have = await readAllowance(publicClient, token, owner, spender);
  mem.set(k, have);
  if (have >= need) return;

  const hash = await wallet.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, maxUint256],
    account: owner,
    chain: wallet.chain,
  });
  await publicClient.waitForTransactionReceipt({ hash });

  // Confirm mined allowance before returning (avoids immediate re-approve).
  for (let i = 0; i < 6; i++) {
    have = await readAllowance(publicClient, token, owner, spender);
    if (have >= need) {
      mem.set(k, have);
      return;
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  mem.set(k, have);
  if (have < need) {
    throw new Error(
      `USDC allowance still ${have.toString()} after approve (need ${need.toString()}). Retry once.`,
    );
  }
}

/** Drop cached allowance (e.g. after a failed spend). */
export function clearAllowanceCache(token?: Address, owner?: Address, spender?: Address) {
  if (!token || !owner || !spender) {
    mem.clear();
    return;
  }
  mem.delete(key(token, owner, spender));
}

export const ensureUsdcAllowance = ensureAllowance;
