import { type Address, isAddress } from "viem";

/** Monad testnet MontaneSwap root (teamKey redeploy). Overridable via NEXT_PUBLIC_SWAP. */
const DEPLOYED_SWAP = "0x14f8C210Aa5eB50CDD59683BEfd89169A5B40763" as const;

/** SeasonPool satellite on Monad testnet. */
const DEPLOYED_SEASON_POOL = "0xc04A778b007a927F9276141296c7EabA2f142dc3" as const;

const raw = (process.env.NEXT_PUBLIC_SWAP ?? DEPLOYED_SWAP).trim();
export const SWAP = isAddress(raw) ? (raw as Address) : undefined;

const seasonRaw = (process.env.NEXT_PUBLIC_SEASON_POOL ?? DEPLOYED_SEASON_POOL).trim();
export const SEASON_POOL = isAddress(seasonRaw) ? (seasonRaw as Address) : undefined;

/** Nad Name Service core on Monad testnet. Returns primary name without .nad */
export const NNS = "0x3019BF1dfB84E5b46Ca9D0eEC37dE08a59A41308" as const;
