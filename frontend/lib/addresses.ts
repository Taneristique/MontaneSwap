import { type Address, isAddress } from "viem";

/** Monad testnet MontaneSwap root (2026-09-21 teamKey redeploy). Overridable via NEXT_PUBLIC_SWAP. */
const DEPLOYED_SWAP = "0x32e947A829b8bB59eae198014998C34855b9aD62" as const;

/** SeasonPool satellite on Monad testnet. */
const DEPLOYED_SEASON_POOL = "0x0792a6e6cA7f196764D0E653cC8D9c099eDF5fE0" as const;

const raw = (process.env.NEXT_PUBLIC_SWAP ?? DEPLOYED_SWAP).trim();
export const SWAP = isAddress(raw) ? (raw as Address) : undefined;

const seasonRaw = (process.env.NEXT_PUBLIC_SEASON_POOL ?? DEPLOYED_SEASON_POOL).trim();
export const SEASON_POOL = isAddress(seasonRaw) ? (seasonRaw as Address) : undefined;

/** Nad Name Service core on Monad testnet. Returns primary name without .nad */
export const NNS = "0x3019BF1dfB84E5b46Ca9D0eEC37dE08a59A41308" as const;
