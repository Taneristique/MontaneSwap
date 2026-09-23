import type { TapeFillJson } from "./tape-server";

/**
 * Optional bootstrap fills for a slow RPC. Keep empty after a full redeploy —
 * stale seeds from a previous MontaneSwap make My fills / Market tape lie.
 */
export const TAPE_SEED: TapeFillJson[] = [];
