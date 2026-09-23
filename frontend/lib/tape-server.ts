import {
  createPublicClient,
  http,
  parseAbi,
  parseAbiItem,
  type Address,
  type Log,
} from "viem";
import { SWAP } from "./addresses";
import { TAPE_SEED } from "./tape-seed";

const rpc = process.env.NEXT_PUBLIC_RPC ?? "https://testnet-rpc.monad.xyz";
const FALLBACK_MARKET =
  "0xf4a2A026e0DfE9773AC78d2C056BB7C4DEb076dD" as Address;

const swapAbi = parseAbi(["function market() view returns (address)"]);
const marketAbi = parseAbi(["function tradeCount() view returns (uint256)"]);
const filledEvent = parseAbiItem(
  "event Filled(uint256 indexed orderId, address indexed taker, uint256 amount, uint256 payUsdc)",
);

const CHUNK = 100n;
/** Background only — request path never waits on this. */
const MAX_CHUNKS = 24;
const PARALLEL = 6;

export type TapeFillJson = {
  orderId: string;
  taker: Address;
  amount: string;
  payUsdc: string;
  price: string;
  blockNumber: string;
  timestampSec: string;
  txHash: `0x${string}`;
  logIndex: number;
};

type Cache = {
  at: number;
  market: Address;
  tradeCount: number;
  fills: TapeFillJson[];
  scannedTo: bigint;
};

let cache: Cache | null = null;
let refreshing: Promise<Cache | null> | null = null;
const TTL_MS = 4_000;

function client() {
  return createPublicClient({
    transport: http(rpc, { timeout: 8_000, retryCount: 0 }),
  });
}

type FilledLog = Log & {
  args?: {
    orderId?: bigint;
    taker?: Address;
    amount?: bigint;
    payUsdc?: bigint;
  };
  blockTimestamp?: bigint;
};

function toFill(log: FilledLog): TapeFillJson | null {
  if (!log.args || log.blockNumber == null || !log.transactionHash) return null;
  const { orderId, taker, amount, payUsdc } = log.args;
  if (orderId == null || !taker || amount == null || payUsdc == null || amount === 0n) {
    return null;
  }
  return {
    orderId: orderId.toString(),
    taker,
    amount: amount.toString(),
    payUsdc: payUsdc.toString(),
    price: ((payUsdc * 10n ** 18n) / amount).toString(),
    blockNumber: log.blockNumber.toString(),
    timestampSec: (log.blockTimestamp ?? 0n).toString(),
    txHash: log.transactionHash,
    logIndex: log.logIndex ?? 0,
  };
}

function mergeFills(prev: TapeFillJson[], next: TapeFillJson[]) {
  const map = new Map<string, TapeFillJson>();
  for (const f of [...prev, ...next]) {
    const key = `${f.txHash}-${f.logIndex}`;
    const old = map.get(key);
    if (old && old.timestampSec !== "0" && f.timestampSec === "0") map.set(key, old);
    else map.set(key, f);
  }
  return [...map.values()]
    .sort((a, b) => {
      const ab = BigInt(a.blockNumber);
      const bb = BigInt(b.blockNumber);
      if (ab === bb) return b.logIndex - a.logIndex;
      return ab > bb ? -1 : 1;
    })
    .slice(0, 120);
}

async function stamp(pc: ReturnType<typeof client>, fills: TapeFillJson[]) {
  const need = [
    ...new Set(fills.filter((f) => f.timestampSec === "0").map((f) => f.blockNumber)),
  ].slice(0, 24);
  if (!need.length) return fills;
  const times = new Map<string, string>();
  await Promise.all(
    need.map(async (bn) => {
      try {
        const block = await pc.getBlock({ blockNumber: BigInt(bn) });
        times.set(bn, block.timestamp.toString());
      } catch {
        /* ignore */
      }
    }),
  );
  return fills.map((f) =>
    f.timestampSec !== "0"
      ? f
      : { ...f, timestampSec: times.get(f.blockNumber) ?? "0" },
  );
}

async function scanRecent(pc: ReturnType<typeof client>, market: Address, tip: bigint) {
  const found: TapeFillJson[] = [];
  for (let base = 0; base < MAX_CHUNKS; base += PARALLEL) {
    const batch = Array.from({ length: PARALLEL }, (_, j) => {
      const i = base + j;
      if (i >= MAX_CHUNKS) return null;
      const toBlock = tip - BigInt(i) * CHUNK;
      if (toBlock < 0n) return null;
      const fromBlock = toBlock + 1n > CHUNK ? toBlock - CHUNK + 1n : 0n;
      return { fromBlock, toBlock };
    }).filter(Boolean) as { fromBlock: bigint; toBlock: bigint }[];
    if (!batch.length) break;

    const parts = await Promise.all(
      batch.map(async ({ fromBlock, toBlock }) => {
        try {
          return await pc.getLogs({
            address: market,
            event: filledEvent,
            fromBlock,
            toBlock,
          });
        } catch {
          return [];
        }
      }),
    );
    for (const logs of parts) {
      for (const log of logs) {
        const row = toFill(log as FilledLog);
        if (row) found.push(row);
      }
    }
    if (found.length >= 20) break;
  }
  return stamp(pc, found);
}

async function refreshTape(): Promise<Cache | null> {
  try {
    const pc = client();
    let market = FALLBACK_MARKET;
    if (SWAP) {
      try {
        market = await pc.readContract({
          address: SWAP,
          abi: swapAbi,
          functionName: "market",
        });
      } catch {
        market = cache?.market ?? FALLBACK_MARKET;
      }
    }

    const tip = await pc.getBlockNumber();
    let tradeCount = cache?.tradeCount ?? 0;
    try {
      tradeCount = Number(
        await pc.readContract({
          address: market,
          abi: marketAbi,
          functionName: "tradeCount",
        }),
      );
    } catch {
      /* keep */
    }

    // Incremental: only new blocks when we already have a cache.
    let fresh: TapeFillJson[];
    if (cache && cache.scannedTo > 0n && cache.scannedTo < tip) {
      fresh = await scanRecent(pc, market, tip);
      // scanRecent always looks back MAX_CHUNKS — merge is fine
    } else {
      fresh = await scanRecent(pc, market, tip);
    }

    cache = {
      at: Date.now(),
      market,
      tradeCount,
      fills: mergeFills(TAPE_SEED, mergeFills(cache?.fills ?? [], fresh)),
      scannedTo: tip,
    };
    return cache;
  } catch {
    return cache;
  }
}

function withSeed(c: Cache | null): Cache {
  const base =
    c ??
    ({
      at: Date.now(),
      market: FALLBACK_MARKET,
      tradeCount: TAPE_SEED.length,
      fills: [] as TapeFillJson[],
      scannedTo: 0n,
    } satisfies Cache);
  return {
    ...base,
    tradeCount: TAPE_SEED.length > 0 ? Math.max(base.tradeCount, TAPE_SEED.length) : base.tradeCount,
    fills: TAPE_SEED.length > 0 ? mergeFills(TAPE_SEED, base.fills) : base.fills,
  };
}

function kickRefresh() {
  if (refreshing) return;
  refreshing = refreshTape().finally(() => {
    refreshing = null;
  });
}

/**
 * Never await RPC on the request path — phone polls every 5s and times out otherwise.
 * Seed ∪ cache returns instantly; scan runs in the background.
 */
export async function getMarketTape(force = false): Promise<Cache> {
  const stale = force || !cache || Date.now() - cache.at >= TTL_MS;
  if (stale) kickRefresh();
  return withSeed(cache);
}
