import { type Address, isAddress } from "viem";

/** Monad testnet MontaneSwap root (2026-09-21 teamKey redeploy). Overridable via NEXT_PUBLIC_SWAP. */
const DEPLOYED_SWAP = "0xE3A43A6d6bd9Ad277E086292C494A0Ace96E3ef5" as const;

/** SeasonPool satellite on Monad testnet. */
const DEPLOYED_SEASON_POOL = "0x550FCf8f52F0304c368d7452b6C7AA2515c7143b" as const;

const raw = (process.env.NEXT_PUBLIC_SWAP ?? DEPLOYED_SWAP).trim();
export const SWAP = isAddress(raw) ? (raw as Address) : undefined;

const seasonRaw = (process.env.NEXT_PUBLIC_SEASON_POOL ?? DEPLOYED_SEASON_POOL).trim();
export const SEASON_POOL = isAddress(seasonRaw) ? (seasonRaw as Address) : undefined;

/** Nad Name Service core on Monad testnet. Returns primary name without .nad */
export const NNS = "0x3019BF1dfB84E5b46Ca9D0eEC37dE08a59A41308" as const;
