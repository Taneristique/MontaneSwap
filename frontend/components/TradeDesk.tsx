"use client";

import { useEffect, useMemo, useState } from "react";
import { type Address } from "viem";
import { useAccount, useReadContract, useReadContracts, useWatchContractEvent } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { creditMarketAbi, cdpAbi, tokenAbi, Side } from "@/lib/abi";
import { SWAP } from "@/lib/addresses";
import { ensureAllowance } from "@/lib/ensure-usdc";
import { fromWad, seasonOf, shortAddr, stampFromUnix, toWad, utcFromUnix } from "@/lib/format";

/** Last N maker opens / personal fills shown in tabs. */
const MY_RECENT = 25;
import { getTxClients } from "@/lib/tx-clients";
import { txError } from "@/lib/tx-error";
import { useFillTape, type FillTape } from "@/lib/use-fill-tape";
import { markHealth, useDisplayMid } from "@/lib/use-display-mid";
import { useNnsNames } from "@/lib/use-nns-name";
import { useProtocol } from "@/lib/use-protocol";
import { monadTestnet } from "@/lib/wagmi";

type Book = "long" | "short";
type SideBtn = "buy" | "sell";
type DeskTab = "market" | "open" | "fills";

type TapeApi = {
  fills: FillTape[];
  loading: boolean;
  refetch: () => Promise<void>;
  lastPrice?: bigint;
  tradeCount?: number;
};

type Live = {
  id: bigint;
  maker: Address;
  cdpId: bigint;
  side: number;
  price: bigint;
  remaining: bigint;
  fomo: boolean;
  landedAt: bigint;
};

type Cdp = {
  issuer: Address;
  longOwner: Address;
  collateralAmount: bigint;
  debtAmount: bigint;
  openedAt: bigint;
  firstSaleAt: bigint;
  openBlock: bigint;
  active: boolean;
};

type Row = Live & {
  issuer: Address;
  f: string;
  g: string;
  h: string;
  season: "Frostbite" | "Verdant";
};

function sideLabel(side: number) {
  if (side === Side.LongAsk) return "Long ask";
  if (side === Side.LongBid) return "Long bid";
  if (side === Side.ShortAsk) return "Short ask";
  if (side === Side.ShortBid) return "Short bid";
  return `Side ${side}`;
}

type Level = {
  price: bigint;
  size: bigint;
  count: number;
  /** Best queue head (lowest id) at this price — for optional exact take. */
  head: Row;
  h: string;
  season: "Frostbite" | "Verdant";
};

function aggregateLevels(orders: Row[], ask: boolean): Level[] {
  const map = new Map<string, Level>();
  for (const o of orders) {
    const k = o.price.toString();
    const cur = map.get(k);
    if (!cur) {
      map.set(k, {
        price: o.price,
        size: o.remaining,
        count: 1,
        head: o,
        h: o.h,
        season: o.season,
      });
      continue;
    }
    cur.size += o.remaining;
    cur.count += 1;
    // Price-time: lower order id sits first in the queue.
    if (o.id < cur.head.id) cur.head = o;
  }
  const levels = [...map.values()];
  // Classic CLOB: asks low→high near mid bottom; we draw asks high→low so best sits above mid.
  // Bids high→low so best sits below mid.
  levels.sort((a, b) => {
    if (a.price === b.price) return 0;
    return ask
      ? a.price > b.price
        ? -1
        : 1
      : a.price > b.price
        ? -1
        : 1;
  });
  return levels;
}

function BookTable({
  asks,
  bids,
  names,
  onPickLevel,
}: {
  asks: Row[];
  bids: Row[];
  names: Map<string, string>;
  onPickLevel: (level: Level, ask: boolean) => void;
}) {
  const askLevels = aggregateLevels(asks, true);
  const bidLevels = aggregateLevels(bids, false);
  const max = Math.max(
    ...askLevels.map((l) => Number(l.size)),
    ...bidLevels.map((l) => Number(l.size)),
    1,
  );

  function line(l: Level, ask: boolean) {
    const t = utcFromUnix(l.head.landedAt);
    const issuerLabel = names.get(l.head.issuer.toLowerCase()) ?? shortAddr(l.head.issuer);
    return (
      <button
        key={`${ask ? "a" : "b"}-${l.price.toString()}`}
        type="button"
        onClick={() => onPickLevel(l, ask)}
        className={`relative grid w-full grid-cols-4 py-1.5 text-left sm:grid-cols-6 ${
          ask ? "text-[#E11D48]" : "text-[#22C55E]"
        } cursor-pointer rounded-md hover:bg-zinc-950/[0.04] dark:hover:bg-white/[0.06]`}
        title={`${l.count} order(s) · head #${l.head.id} · click → limit @ ${fromWad(l.price)} (placeOrder match)`}
      >
        <span
          className={`absolute inset-y-0 right-0 ${ask ? "bg-[#E11D48]/10" : "bg-[#22C55E]/10"}`}
          style={{ width: `${(Number(l.size) / max) * 100}%` }}
        />
        <span className="relative font-medium">{fromWad(l.price)}</span>
        <span className="relative text-right">{fromWad(l.size, 2)}</span>
        <span
          className={`relative text-right ${l.season === "Frostbite" ? "text-[#E11D48]" : "text-[#22C55E]"}`}
        >
          {l.h}
        </span>
        <span className="relative hidden truncate text-right text-zinc-500 sm:block">
          {l.count > 1 ? `${l.count}×` : shortAddr(l.head.maker)}
        </span>
        <span className="relative hidden truncate text-right text-zinc-500 sm:block" title={l.head.issuer}>
          {issuerLabel}
        </span>
        <span className="relative text-right text-zinc-500" title={t.iso}>
          <span className="sm:hidden">{t.hms}</span>
          <span className="hidden sm:inline">{t.full}</span>
        </span>
      </button>
    );
  }

  return (
    <div className="font-mono text-xs sm:text-sm">
      <div className="mb-2 grid grid-cols-4 text-[11px] text-zinc-500 sm:grid-cols-6 sm:text-xs">
        <span>Px</span>
        <span className="text-right">Size</span>
        <span className="text-right">H@mark</span>
        <span className="hidden text-right sm:block">Depth</span>
        <span className="hidden text-right sm:block">Issuer</span>
        <span className="text-right">Time</span>
      </div>
      {askLevels.map((l) => line(l, true))}
      <div className="my-2 border-y border-zinc-200 py-2 text-center text-[11px] text-zinc-500 dark:border-white/10 sm:text-xs">
        click level → limit · placeOrder walks book · My open = last {MY_RECENT} maker
      </div>
      {bidLevels.map((l) => line(l, false))}
      {askLevels.length === 0 && bidLevels.length === 0 && (
        <p className="py-6 text-center text-xs text-zinc-500">No live orders on this book.</p>
      )}
    </div>
  );
}

export function TradeDesk({ fillTape }: { fillTape?: TapeApi } = {}) {
  const [book, setBook] = useState<Book>("long");
  const [side, setSide] = useState<SideBtn>("buy");
  const [size, setSize] = useState("25");
  const [price, setPrice] = useState("1.005");
  const [priceLocked, setPriceLocked] = useState(false);
  const [pickedCdp, setPickedCdp] = useState<bigint | null>(null);
  const [pickedOrderId, setPickedOrderId] = useState<bigint | null>(null);
  const [levelHeadId, setLevelHeadId] = useState<bigint | null>(null);
  const [tab, setTab] = useState<DeskTab>("market");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const protocol = useProtocol();
  const localTape = useFillTape(fillTape ? undefined : protocol.market);
  const tape = fillTape ?? localTape;
  const mid = useDisplayMid(protocol.market, tape.lastPrice);
  const markPx = mid.markPx > 0n ? mid.markPx : 10n ** 18n;

  const live = useReadContract({
    address: protocol.market,
    abi: creditMarketAbi,
    functionName: "liveBook",
    chainId: monadTestnet.id,
    query: {
      enabled: Boolean(protocol.market),
      refetchInterval: 1000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      staleTime: 0,
    },
  });

  // Instant book: any seal / fill / cancel → refetch liveBook (placeOrder ends in _seal).
  useWatchContractEvent({
    address: protocol.market,
    abi: creditMarketAbi,
    eventName: "Sealed",
    chainId: monadTestnet.id,
    enabled: Boolean(protocol.market),
    onLogs() {
      void live.refetch();
    },
  });
  useWatchContractEvent({
    address: protocol.market,
    abi: creditMarketAbi,
    eventName: "Filled",
    chainId: monadTestnet.id,
    enabled: Boolean(protocol.market),
    onLogs() {
      void live.refetch();
      void tape.refetch();
    },
  });
  useWatchContractEvent({
    address: protocol.market,
    abi: creditMarketAbi,
    eventName: "OrderCancelled",
    chainId: monadTestnet.id,
    enabled: Boolean(protocol.market),
    onLogs() {
      void live.refetch();
    },
  });
  const cost = useReadContract({
    address: protocol.token,
    abi: tokenAbi,
    functionName: "getIssuanceCost",
    chainId: monadTestnet.id,
    query: { enabled: Boolean(protocol.token) },
  });
  const tradeCount = useReadContract({
    address: protocol.market,
    abi: creditMarketAbi,
    functionName: "tradeCount",
    chainId: monadTestnet.id,
    query: {
      enabled: Boolean(protocol.market),
      refetchInterval: 5000,
      refetchOnWindowFocus: true,
    },
  });
  const v100 = useReadContract({
    address: protocol.market,
    abi: creditMarketAbi,
    functionName: "v100",
    chainId: monadTestnet.id,
    query: {
      enabled: Boolean(protocol.market),
      refetchInterval: 5000,
      refetchOnWindowFocus: true,
    },
  });

  const raw = (live.data ?? []) as Live[];
  const ids = [...new Set(raw.map((o) => o.cdpId).filter((id) => id > 0n))];
  const cells = useReadContracts({
    contracts: ids.flatMap((id) => [
      {
        address: protocol.position,
        abi: cdpAbi,
        functionName: "getCDP" as const,
        args: [id] as const,
        chainId: monadTestnet.id,
      },
      {
        address: protocol.position,
        abi: cdpAbi,
        functionName: "health" as const,
        args: [id] as const,
        chainId: monadTestnet.id,
      },
    ]),
    query: {
      enabled: Boolean(protocol.position) && ids.length > 0,
      refetchInterval: 2000,
      refetchOnWindowFocus: true,
    },
  });

  const orderIds = useMemo(
    () => [...new Set(tape.fills.map((f) => f.orderId))].slice(0, 120),
    [tape.fills],
  );
  const orderMeta = useReadContracts({
    contracts: orderIds.map((id) => ({
      address: protocol.market!,
      abi: creditMarketAbi,
      functionName: "orders" as const,
      args: [id] as const,
      chainId: monadTestnet.id,
    })),
    query: { enabled: Boolean(protocol.market) && orderIds.length > 0 },
  });

  const orderById = useMemo(() => {
    const map = new Map<
      string,
      {
        maker: Address;
        cdpId: bigint;
        side: number;
        price: bigint;
        remaining: bigint;
        active: boolean;
      }
    >();
    orderIds.forEach((id, i) => {
      const r = orderMeta.data?.[i]?.result as
        | readonly [Address, bigint, number, bigint, bigint, boolean, boolean, bigint]
        | undefined;
      if (!r) return;
      map.set(id.toString(), {
        maker: r[0],
        cdpId: r[1],
        side: r[2],
        price: r[3],
        remaining: r[4],
        active: r[5],
      });
    });
    return map;
  }, [orderIds, orderMeta.data]);

  const rows: Row[] = raw.map((o) => {
    const idx = ids.indexOf(o.cdpId);
    const cdp = idx >= 0 ? (cells.data?.[idx * 2]?.result as Cdp | undefined) : undefined;
    const hWad = idx >= 0 ? (cells.data?.[idx * 2 + 1]?.result as bigint | undefined) : undefined;
    const issuer = cdp?.issuer ?? o.maker;
    const hMark =
      cdp && cdp.debtAmount > 0n
        ? markHealth(cdp.collateralAmount, cdp.debtAmount, markPx)
        : (hWad ?? 0n);
    return {
      ...o,
      issuer,
      f: cdp ? fromWad(cdp.debtAmount, 0) : "—",
      g: cdp ? fromWad(cdp.collateralAmount, 2) : "—",
      h: hMark > 0n ? fromWad(hMark, 2) : "—",
      season: hMark > 0n ? seasonOf(hMark) : "Verdant",
    };
  });

  const names = useNnsNames(rows.map((r) => r.issuer));

  const shown = useMemo(() => {
    if (book === "long") {
      return {
        asks: rows.filter((o) => o.side === Side.LongAsk),
        bids: rows.filter((o) => o.side === Side.LongBid),
      };
    }
    return {
      asks: rows.filter((o) => o.side === Side.ShortAsk),
      bids: rows.filter((o) => o.side === Side.ShortBid),
    };
  }, [book, rows]);

  const best = useMemo(() => {
    if (side === "buy") {
      return [...shown.asks].sort((a, b) => {
        if (a.price !== b.price) return a.price < b.price ? -1 : 1;
        return a.id < b.id ? -1 : 1;
      })[0];
    }
    return [...shown.bids].sort((a, b) => {
      if (a.price !== b.price) return a.price > b.price ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    })[0];
  }, [side, shown.asks, shown.bids]);

  useEffect(() => {
    if (priceLocked) return;
    if (best) setPrice(fromWad(best.price));
    else setPrice(book === "long" ? (side === "buy" ? "1.005" : "1.005") : "0.995");
  }, [best, book, side, priceLocked]);

  const depthAsk = shown.asks.reduce((s, o) => s + o.remaining, 0n);
  const depthBid = shown.bids.reduce((s, o) => s + o.remaining, 0n);
  const tapeVol = tape.fills.reduce((s, f) => s + f.amount, 0n);

  const myOpen = useMemo(() => {
    if (!address) return [];
    const me = address.toLowerCase();
    return rows
      .filter((o) => o.maker.toLowerCase() === me)
      .sort((a, b) => {
        if (a.landedAt === b.landedAt) return a.id > b.id ? -1 : 1;
        return a.landedAt > b.landedAt ? -1 : 1;
      })
      .slice(0, MY_RECENT);
  }, [rows, address]);

  /** Market: every live order + recent fills. */
  const marketRows = useMemo(() => {
    const open = rows.map((o) => ({
      key: `open-${o.id}`,
      px: fromWad(o.price),
      size: fromWad(o.remaining, 2),
      usdc: "—",
      who: shortAddr(o.maker),
      detail: sideLabel(o.side),
      status: "open" as const,
      time: stampFromUnix(o.landedAt),
      sort: o.landedAt,
    }));
    const filled = tape.fills.slice(0, 40).map((f) => {
      const meta = orderById.get(f.orderId.toString());
      return {
        key: `fill-${f.txHash}-${f.logIndex}`,
        px: fromWad(f.price),
        size: fromWad(f.amount, 2),
        usdc: fromWad(f.payUsdc, 2),
        who: shortAddr(f.taker),
        detail: meta ? sideLabel(meta.side) : `#${f.orderId}`,
        status: "filled" as const,
        time: f.timestampSec > 0n ? stampFromUnix(f.timestampSec) : "—",
        sort: f.timestampSec > 0n ? f.timestampSec : f.blockNumber,
      };
    });
    return [...open, ...filled].sort((a, b) => Number(b.sort - a.sort));
  }, [rows, tape.fills, orderById]);

  /** My fills: I was taker, or my resting order was filled (maker). Newest first, last N. */
  const myFills = useMemo(() => {
    if (!address) return [];
    const me = address.toLowerCase();
    return tape.fills
      .filter((f) => {
        if (f.taker.toLowerCase() === me) return true;
        const meta = orderById.get(f.orderId.toString());
        return meta?.maker.toLowerCase() === me;
      })
      .sort((a, b) => {
        const ta = a.timestampSec > 0n ? a.timestampSec : a.blockNumber;
        const tb = b.timestampSec > 0n ? b.timestampSec : b.blockNumber;
        if (ta === tb) return b.logIndex - a.logIndex;
        return ta > tb ? -1 : 1;
      })
      .slice(0, MY_RECENT);
  }, [tape.fills, address, orderById]);

  const label =
    side === "buy"
      ? book === "long"
        ? "Buy long · lift ask"
        : "Buy short · lift ask"
      : book === "long"
        ? "Sell long · hit bid / post ask"
        : "Sell short · hit bid / post ask";

  const enumSide =
    book === "long"
      ? side === "buy"
        ? Side.LongBid
        : Side.LongAsk
      : side === "buy"
        ? Side.ShortBid
        : Side.ShortAsk;

  /** Click book level → set limit price; submit uses placeOrder (match then rest). */
  function pickLevel(l: Level, ask: boolean) {
    const o = l.head;
    const nextBook =
      o.side === Side.LongAsk || o.side === Side.LongBid ? "long" : "short";
    const nextSide: SideBtn = ask ? "buy" : "sell";
    setBook(nextBook);
    setSide(nextSide);
    setPrice(fromWad(l.price));
    setPriceLocked(true);
    setPickedCdp(o.cdpId > 0n ? o.cdpId : null);
    setPickedOrderId(null);
    setLevelHeadId(o.id);
    setSize(fromWad(l.size, 4).replace(/\.?0+$/, "") || fromWad(l.size, 2));
    setNote(
      ask
        ? `Limit buy ${nextBook} @ ${fromWad(l.price)} · placeOrder walks asks ≤ px (${l.count} lvl). Exact #${o.id} optional.`
        : `Limit sell ${nextBook} @ ${fromWad(l.price)} · placeOrder walks bids ≥ px (${l.count} lvl). Exact #${o.id} optional.`,
    );
  }

  function takeExact(orderId: bigint) {
    const o = rows.find((r) => r.id === orderId);
    if (!o) return;
    const ask = o.side === Side.LongAsk || o.side === Side.ShortAsk;
    setPickedOrderId(o.id);
    setPickedCdp(o.cdpId > 0n ? o.cdpId : null);
    setPrice(fromWad(o.price));
    setPriceLocked(true);
    setSize(fromWad(o.remaining, 4).replace(/\.?0+$/, "") || fromWad(o.remaining, 2));
    setNote(
      ask
        ? `Exact lift #${o.id} @ ${fromWad(o.price)} → fillOrder (single resting order).`
        : `Exact hit #${o.id} @ ${fromWad(o.price)} → fillOrder (single resting order).`,
    );
  }

  async function cancel(orderId: bigint) {
    setBusy(true);
    setNote(null);
    try {
      const { publicClient, wallet } = await getTxClients();
      const hash = await wallet.writeContract({
        address: protocol.market!,
        abi: creditMarketAbi,
        functionName: "cancelOrder",
        args: [orderId],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setNote(`Cancelled order #${orderId}.`);
      await live.refetch();
    } catch (e) {
      setNote(txError(e));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }
    if (!SWAP) {
      setNote("NEXT_PUBLIC_SWAP is missing. Check frontend/.env.local.");
      return;
    }
    if (!protocol.ready) {
      setNote(
        protocol.error
          ? `Protocol not loaded: ${protocol.error.message}`
          : "Loading protocol… use Monad testnet (10143).",
      );
      return;
    }
    const amt = toWad(size);
    const px = toWad(price);
    if (amt <= 0n || px <= 0n) {
      setNote("Size and price must be positive.");
      return;
    }
    const cdpId = pickedCdp ?? best?.cdpId ?? 0n;
    const takeId = pickedOrderId;
    setBusy(true);
    setNote(null);
    try {
      const { publicClient, wallet, address: from } = await getTxClients();
      const issuance = cost.data && cost.data > 0n ? cost.data : 10n ** 18n;
      const usdcNeed = (amt * px) / issuance;

      if (takeId != null) {
        const resting = raw.find((o) => o.id === takeId)?.side ?? enumSide;
        if (resting === Side.LongAsk || resting === Side.ShortAsk) {
          await ensureAllowance({
            publicClient,
            wallet,
            token: protocol.usdc!,
            owner: from,
            spender: protocol.market!,
            need: usdcNeed,
          });
        } else if (resting === Side.LongBid) {
          await ensureAllowance({
            publicClient,
            wallet,
            token: protocol.token!,
            owner: from,
            spender: protocol.market!,
            need: amt,
          });
        }
        const hash = await wallet.writeContract({
          address: protocol.market!,
          abi: creditMarketAbi,
          functionName: "fillOrder",
          args: [takeId, amt],
        });
        const rec = await publicClient.waitForTransactionReceipt({ hash });
        setNote(
          `Filled #${takeId}. ${rec.status === "success" ? rec.transactionHash : "reverted"}.`,
        );
      } else {
        if (side === "buy") {
          await ensureAllowance({
            publicClient,
            wallet,
            token: protocol.usdc!,
            owner: from,
            spender: protocol.market!,
            need: usdcNeed,
          });
        } else if (book === "long") {
          await ensureAllowance({
            publicClient,
            wallet,
            token: protocol.token!,
            owner: from,
            spender: protocol.market!,
            need: amt,
          });
        }
        const hash = await wallet.writeContract({
          address: protocol.market!,
          abi: creditMarketAbi,
          functionName: "placeOrder",
          args: [cdpId, enumSide, px, amt],
        });
        const rec = await publicClient.waitForTransactionReceipt({ hash });
        setNote(
          `Limit ${label}. ${rec.status === "success" ? "Matched/rested · " + rec.transactionHash : "reverted"}.`,
        );
      }
      setPriceLocked(false);
      setPickedOrderId(null);
      setLevelHeadId(null);
      // Immediate book refresh — don't wait for poll / event lag.
      await Promise.all([live.refetch(), tape.refetch()]);
    } catch (e) {
      setNote(txError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={`${book} ask depth`} value={`${fromWad(depthAsk, 2)} mM`} />
        <Stat label={`${book} bid depth`} value={`${fromWad(depthBid, 2)} mM`} />
        <Stat
          label="v100 volume"
          value={v100.data != null ? `${fromWad(v100.data, 2)} mM` : "—"}
        />
        <Stat
          label="trades"
          value={tradeCount.data != null ? tradeCount.data.toString() : "—"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr] lg:gap-6">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 dark:border-white/10 dark:bg-white/[0.03]">
          {!SWAP && (
            <p className="mb-3 text-xs text-[#E11D48]">
              Set NEXT_PUBLIC_SWAP to the MontaneSwap address. The book is empty until then.
            </p>
          )}
          {protocol.error && (
            <p className="mb-3 text-xs text-[#E11D48]">{txError(protocol.error)}</p>
          )}
          <div className="mb-3 flex gap-1 sm:mb-4">
            {(["long", "short"] as const).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => {
                  setBook(b);
                  setPriceLocked(false);
                  setPickedCdp(null);
                  setPickedOrderId(null);
                  setLevelHeadId(null);
                  setNote(null);
                }}
                className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize ${
                  book === b
                    ? "bg-zinc-950 text-white dark:bg-white dark:text-[#0B0F14]"
                    : "text-zinc-500 hover:bg-zinc-950/5 dark:hover:bg-white/10"
                }`}
              >
                {b}
              </button>
            ))}
          </div>
          <p className="mb-3 text-xs text-zinc-500 sm:mb-4">
            Price levels aggregate resting size. Click sets a limit; Buy/Sell runs{" "}
            <span className="font-mono">placeOrder</span> (match then rest leftover). Long
            and short never cross.
          </p>
          <BookTable asks={shown.asks} bids={shown.bids} names={names} onPickLevel={pickLevel} />
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="flex gap-1">
            {(["buy", "sell"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setSide(s);
                  setPriceLocked(false);
                  setPickedOrderId(null);
                  setLevelHeadId(null);
                }}
                className={`min-h-11 flex-1 rounded-full py-2 text-sm font-medium ${
                  side === s
                    ? s === "buy"
                      ? "bg-[#22C55E] text-[#0B0F14]"
                      : "bg-[#E11D48] text-white"
                    : "text-zinc-500 hover:bg-zinc-950/5 dark:hover:bg-white/10"
                }`}
              >
                {s === "buy" ? `Buy ${book}` : `Sell ${book}`}
              </button>
            ))}
          </div>
          <label className="mt-5 flex flex-col gap-2 text-sm">
            <span className="text-zinc-500">Size (mMonad)</span>
            <input
              value={size}
              inputMode="decimal"
              onChange={(e) => setSize(e.target.value)}
              className="min-h-11 rounded-xl border border-zinc-200 bg-transparent px-4 py-3 text-base font-mono outline-none focus:border-zinc-400 dark:border-white/10"
            />
          </label>
          <label className="mt-4 flex flex-col gap-2 text-sm">
            <span className="flex items-center justify-between text-zinc-500">
              Price
              {priceLocked && (
                <button
                  type="button"
                  className="text-[11px] text-zinc-400 underline-offset-2 hover:underline"
                  onClick={() => {
                    setPriceLocked(false);
                    setPickedCdp(null);
                    setPickedOrderId(null);
                    setLevelHeadId(null);
                  }}
                >
                  follow best
                </button>
              )}
            </span>
            <input
              value={price}
              inputMode="decimal"
              onChange={(e) => {
                setPrice(e.target.value);
                setPriceLocked(true);
              }}
              className="min-h-11 rounded-xl border border-zinc-200 bg-transparent px-4 py-3 text-base font-mono outline-none focus:border-zinc-400 dark:border-white/10"
            />
          </label>
          <p className="mt-3 text-xs text-zinc-500">
            Taker 5 bps. {label}
            {pickedOrderId != null
              ? ` · exact fill #${pickedOrderId}`
              : pickedCdp != null
                ? ` · cell #${pickedCdp}`
                : " · limit placeOrder"}
            .
            {levelHeadId != null && pickedOrderId == null && (
              <>
                {" "}
                <button
                  type="button"
                  className="underline-offset-2 hover:underline"
                  onClick={() => takeExact(levelHeadId)}
                >
                  exact #{levelHeadId.toString()}
                </button>
              </>
            )}
            {levelHeadId == null && best && pickedOrderId == null && (
              <>
                {" "}
                <button
                  type="button"
                  className="underline-offset-2 hover:underline"
                  onClick={() => takeExact(best.id)}
                >
                  exact #{best.id.toString()}
                </button>
              </>
            )}
          </p>
          {note && (
            <p className="mt-2 text-xs leading-5 text-zinc-600 dark:text-zinc-400">{note}</p>
          )}
          <button
            type="button"
            disabled={busy || !SWAP}
            onClick={() => void submit()}
            className={`mt-5 min-h-12 w-full rounded-full py-3 text-sm font-medium disabled:opacity-40 ${
              side === "buy" ? "bg-[#22C55E] text-[#0B0F14]" : "bg-[#E11D48] text-white"
            }`}
          >
            {busy ? "Sending…" : label}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {(
            [
              ["market", "Market"],
              ["open", "My open"],
              ["fills", "My fills"],
            ] as const
          ).map(([k, labelTab]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium sm:text-sm ${
                tab === k
                  ? "bg-zinc-950 text-white dark:bg-white dark:text-[#0B0F14]"
                  : "text-zinc-500 hover:bg-zinc-950/5 dark:hover:bg-white/10"
              }`}
            >
              {labelTab}
              {k === "market" && marketRows.length > 0 ? ` (${marketRows.length})` : ""}
              {k === "open" && myOpen.length > 0 ? ` (${myOpen.length})` : ""}
              {k === "fills" && myFills.length > 0 ? ` (${myFills.length})` : ""}
            </button>
          ))}
          <span className="ml-auto flex items-center gap-2 font-mono text-[11px] text-zinc-500">
            <button
              type="button"
              onClick={() => void tape.refetch()}
              className="rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-600 hover:bg-zinc-950/5 dark:border-white/10 dark:text-zinc-400 dark:hover:bg-white/10"
            >
              Refresh
            </button>
            {tape.fills.length}/{tape.tradeCount ?? "?"} fills
            {tape.loading ? " · …" : ""} · tape {fromWad(tapeVol, 2)} mM
          </span>
        </div>

        {tab === "market" && (
          <TapeTable
            empty="No open orders or recent fills."
            rows={marketRows.map(({ sort: _s, ...r }) => r)}
          />
        )}

        {tab === "open" && (
          <div className="font-mono text-xs sm:text-sm">
            {!address && (
              <p className="py-6 text-center text-xs text-zinc-500">Connect to see your open orders.</p>
            )}
            {address && myOpen.length === 0 && (
              <p className="py-6 text-center text-xs text-zinc-500">
                No pending maker orders (showing last {MY_RECENT}).
              </p>
            )}
            {myOpen.map((o) => (
              <div
                key={o.id.toString()}
                className="grid grid-cols-[1.1fr_0.8fr_0.8fr_1.4fr_auto] items-center gap-2 border-b border-zinc-100 py-2 dark:border-white/5 sm:grid-cols-[1.2fr_1fr_1fr_1.6fr_0.8fr_auto]"
              >
                <span className="text-zinc-500">{sideLabel(o.side)}</span>
                <span>{fromWad(o.price)}</span>
                <span className="text-right">{fromWad(o.remaining, 2)}</span>
                <span className="text-right text-[11px] text-zinc-500 sm:text-xs">
                  {stampFromUnix(o.landedAt)}
                </span>
                <span className="hidden text-right text-[#F59E0B] sm:block">pending</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void cancel(o.id)}
                  className="justify-self-end rounded-full px-3 py-1 text-[11px] text-zinc-500 hover:bg-zinc-950/5 dark:hover:bg-white/10"
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        )}

        {tab === "fills" && (
          <TapeTable
            empty={
              address
                ? `No fills yet as taker/maker (last ${MY_RECENT} of your tape).`
                : "Connect to see your fills."
            }
            rows={myFills.map((f) => {
              const meta = orderById.get(f.orderId.toString());
              const me = address?.toLowerCase();
              const role =
                f.taker.toLowerCase() === me
                  ? "taker"
                  : meta?.maker.toLowerCase() === me
                    ? "maker"
                    : "—";
              return {
                key: `${f.txHash}-${f.logIndex}`,
                px: fromWad(f.price),
                size: fromWad(f.amount, 2),
                usdc: fromWad(f.payUsdc, 2),
                who: role,
                detail: meta ? sideLabel(meta.side) : `#${f.orderId}`,
                status: "filled",
                time: f.timestampSec > 0n ? stampFromUnix(f.timestampSec) : "—",
              };
            })}
          />
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 px-3 py-3 dark:border-white/10 sm:px-4">
      <p className="text-[11px] text-zinc-500 sm:text-xs">{label}</p>
      <p className="mt-1 font-mono text-sm sm:text-base">{value}</p>
    </div>
  );
}

function TapeTable({
  rows,
  empty,
}: {
  empty: string;
  rows: {
    key: string;
    px: string;
    size: string;
    usdc: string;
    who: string;
    detail: string;
    status: string;
    time: string;
  }[];
}) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-xs text-zinc-500">{empty}</p>;
  }
  return (
    <div className="font-mono text-xs sm:text-sm">
      <div className="mb-2 grid grid-cols-6 text-[11px] text-zinc-500 sm:text-xs">
        <span>Px</span>
        <span className="text-right">Size</span>
        <span className="text-right">USDC</span>
        <span className="text-right">Side</span>
        <span className="text-right">Status</span>
        <span className="text-right">Time (UTC)</span>
      </div>
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-6 border-b border-zinc-100 py-1.5 dark:border-white/5">
          <span title={r.who}>{r.px}</span>
          <span className="text-right">{r.size}</span>
          <span className="text-right">{r.usdc}</span>
          <span className="truncate text-right text-zinc-500" title={r.who}>
            {r.detail}
          </span>
          <span
            className={`text-right ${r.status === "open" ? "text-[#F59E0B]" : "text-[#22C55E]"}`}
          >
            {r.status}
          </span>
          <span className="text-right text-[11px] text-zinc-500 sm:text-xs" title={r.time}>
            {r.time}
          </span>
        </div>
      ))}
    </div>
  );
}
