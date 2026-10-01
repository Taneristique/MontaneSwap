"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { erc20Abi, type Address } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { cdpAbi, creditMarketAbi, seasonPoolAbi, Side, tokenAbi } from "@/lib/abi";
import { SEASON_POOL, SWAP } from "@/lib/addresses";
import { fromWad, pnlLabel, seasonOf, stampFromUnix } from "@/lib/format";
import { getTxClients } from "@/lib/tx-clients";
import { txError } from "@/lib/tx-error";
import { useDisplayMid } from "@/lib/use-display-mid";
import { useFillTape } from "@/lib/use-fill-tape";
import { useNowSec } from "@/lib/use-now-sec";
import { useProtocol } from "@/lib/use-protocol";
import { monadTestnet } from "@/lib/wagmi";
import { noRestore } from "@/lib/no-restore";

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

function sideLabel(side: number) {
  if (side === Side.LongAsk) return "Long ask";
  if (side === Side.LongBid) return "Long bid";
  if (side === Side.ShortAsk) return "Short ask";
  if (side === Side.ShortBid) return "Short bid";
  return `Side ${side}`;
}

function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "red" | "amber";
}) {
  const cls =
    tone === "green"
      ? "bg-[#22C55E]/15 text-[#15803d] dark:text-[#22C55E]"
      : tone === "red"
        ? "bg-[#E11D48]/15 text-[#E11D48]"
        : tone === "amber"
          ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
          : "bg-zinc-950/5 text-zinc-600 dark:bg-white/10 dark:text-zinc-300";
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium ${cls}`}>
      {children}
    </span>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
      <p className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 font-mono text-lg font-medium tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}

export default function PortfolioPage() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const protocol = useProtocol();
  const tape = useFillTape(protocol.market);
  const mid = useDisplayMid(protocol.market, tape.lastPrice);
  const me = address?.toLowerCase();

  const usdcBal = useReadContract({
    address: protocol.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: monadTestnet.id,
    query: { enabled: Boolean(protocol.usdc && address), refetchInterval: 5000 },
  });
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const nextId = useReadContract({
    address: protocol.position,
    abi: cdpAbi,
    functionName: "nextId",
    chainId: monadTestnet.id,
    query: { enabled: Boolean(protocol.position), refetchInterval: 5000 },
  });
  const last = Number(nextId.data ?? 0n);
  const ids = useMemo(() => Array.from({ length: last }, (_, i) => BigInt(i + 1)), [last]);

  const cellsPack = useReadContracts({
    contracts: ids.flatMap((id) => [
      {
        address: protocol.position!,
        abi: cdpAbi,
        functionName: "getCDP" as const,
        args: [id] as const,
        chainId: monadTestnet.id,
      },
      {
        address: protocol.position!,
        abi: cdpAbi,
        functionName: "health" as const,
        args: [id] as const,
        chainId: monadTestnet.id,
      },
    ]),
    query: {
      enabled: Boolean(protocol.position) && ids.length > 0 && Boolean(address),
      refetchInterval: 5000,
    },
  });

  const notesPack = useReadContracts({
    contracts: ids.flatMap((id) => [
      {
        address: protocol.token!,
        abi: tokenAbi,
        functionName: "balanceOf" as const,
        args: [address!, id] as const,
        chainId: monadTestnet.id,
      },
      {
        address: protocol.token!,
        abi: tokenAbi,
        functionName: "redeemOpen" as const,
        args: [id] as const,
        chainId: monadTestnet.id,
      },
      {
        address: protocol.token!,
        abi: tokenAbi,
        functionName: "redeemPool" as const,
        args: [id] as const,
        chainId: monadTestnet.id,
      },
      {
        address: protocol.token!,
        abi: tokenAbi,
        functionName: "totalSupply" as const,
        args: [id] as const,
        chainId: monadTestnet.id,
      },
    ]),
    query: {
      enabled: Boolean(protocol.token && address) && ids.length > 0,
      refetchInterval: 5000,
    },
  });

  const live = useReadContract({
    address: protocol.market,
    abi: creditMarketAbi,
    functionName: "liveBook",
    chainId: monadTestnet.id,
    query: { enabled: Boolean(protocol.market && address), refetchInterval: 4000 },
  });

  const shortPack = useReadContracts({
    contracts: ids.map((id) => ({
      address: protocol.market!,
      abi: creditMarketAbi,
      functionName: "shortClaim" as const,
      args: [id, address!] as const,
      chainId: monadTestnet.id,
    })),
    query: {
      enabled: Boolean(protocol.market && address) && ids.length > 0,
      refetchInterval: 5000,
    },
  });

  const seasonIds = useReadContracts({
    contracts: ids.map((id) => ({
      address: SEASON_POOL!,
      abi: seasonPoolAbi,
      functionName: "marketOfCdp" as const,
      args: [id] as const,
      chainId: monadTestnet.id,
    })),
    query: {
      enabled: Boolean(SEASON_POOL && address) && ids.length > 0,
      refetchInterval: 8000,
    },
  });

  const seasonMarketIds = useMemo(() => {
    const out: { cdpId: bigint; mid: bigint }[] = [];
    ids.forEach((id, i) => {
      const mid = seasonIds.data?.[i]?.result as bigint | undefined;
      if (mid && mid > 0n) out.push({ cdpId: id, mid });
    });
    return out;
  }, [ids, seasonIds.data]);

  const seasonBal = useReadContracts({
    contracts: seasonMarketIds.flatMap(({ mid }) => [
      {
        address: SEASON_POOL!,
        abi: seasonPoolAbi,
        functionName: "verdantOf" as const,
        args: [mid, address!] as const,
        chainId: monadTestnet.id,
      },
      {
        address: SEASON_POOL!,
        abi: seasonPoolAbi,
        functionName: "frostbiteOf" as const,
        args: [mid, address!] as const,
        chainId: monadTestnet.id,
      },
      {
        address: SEASON_POOL!,
        abi: seasonPoolAbi,
        functionName: "markets" as const,
        args: [mid] as const,
        chainId: monadTestnet.id,
      },
      {
        address: SEASON_POOL!,
        abi: seasonPoolAbi,
        functionName: "maturityOf" as const,
        args: [mid] as const,
        chainId: monadTestnet.id,
      },
      {
        address: SEASON_POOL!,
        abi: seasonPoolAbi,
        functionName: "previewClaim" as const,
        args: [mid, address!] as const,
        chainId: monadTestnet.id,
      },
      {
        address: SEASON_POOL!,
        abi: seasonPoolAbi,
        functionName: "claimed" as const,
        args: [mid, address!] as const,
        chainId: monadTestnet.id,
      },
    ]),
    query: {
      enabled: Boolean(SEASON_POOL && address) && seasonMarketIds.length > 0,
      refetchInterval: 5000,
      staleTime: 0,
      placeholderData: undefined,
      structuralSharing: false,
    },
  });

  const myNotes = useMemo(() => {
    if (!me) return [];
    return ids
      .map((id, i) => {
        const held = notesPack.data?.[i * 4]?.result as bigint | undefined;
        if (!held || held === 0n) return null;
        const open = Boolean(notesPack.data?.[i * 4 + 1]?.result);
        const pool = (notesPack.data?.[i * 4 + 2]?.result as bigint | undefined) ?? 0n;
        const supply = (notesPack.data?.[i * 4 + 3]?.result as bigint | undefined) ?? 0n;
        const cdp = cellsPack.data?.[i * 2]?.result as Cdp | undefined;
        const claim = open && supply > 0n ? (pool * held) / supply : 0n;
        return { id, held, open, claim, active: Boolean(cdp?.active) };
      })
      .filter((n): n is NonNullable<typeof n> => n !== null);
  }, [ids, notesPack.data, cellsPack.data, me]);

  const myCells = useMemo(() => {
    if (!me) return [];
    return ids
      .map((id, i) => {
        const cdp = cellsPack.data?.[i * 2]?.result as Cdp | undefined;
        const hOn = cellsPack.data?.[i * 2 + 1]?.result as bigint | undefined;
        if (!cdp?.active) return null;
        const isIssuer = cdp.issuer.toLowerCase() === me;
        const held = (notesPack.data?.[i * 4]?.result as bigint | undefined) ?? 0n;
        const isHolder = held > 0n;
        if (!isIssuer && !isHolder) return null;
        const season = seasonOf(hOn != null && hOn > 0n ? hOn : 0n);
        return { id, cdp, hOn, season, isIssuer, isHolder, held };
      })
      .filter(Boolean);
  }, [ids, cellsPack.data, notesPack.data, me]);

  const myOrders = useMemo(() => {
    if (!me) return [];
    const rows = (live.data ?? []) as Live[];
    return rows.filter((o) => o.maker.toLowerCase() === me && o.remaining > 0n);
  }, [live.data, me]);

  const nowSec = useNowSec();
  const myShorts = useMemo(() => {
    if (!me) return [];
    return ids
      .map((id, i) => {
        const row = shortPack.data?.[i]?.result as
          | readonly [bigint, bigint, boolean, bigint, bigint]
          | undefined;
        if (!row) return null;
        const [short, written, settled, mark, payout] = row;
        if (short === 0n && written === 0n) return null;
        const cdp = cellsPack.data?.[i * 2]?.result as Cdp | undefined;
        const start = cdp ? (cdp.firstSaleAt > 0n ? cdp.firstSaleAt : cdp.openedAt) : 0n;
        const matureAt = start + 86400n;
        return { id, short, written, settled, mark, payout, matureAt };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }, [ids, shortPack.data, cellsPack.data, me]);

  async function shortTx(key: string, fn: "settleShorts" | "claimShort", cdpId: bigint) {
    setBusy(key);
    setNote(null);
    try {
      const { publicClient, wallet, address: from } = await getTxClients();
      const hash =
        fn === "settleShorts"
          ? await wallet.writeContract({
              address: protocol.market!,
              abi: creditMarketAbi,
              functionName: "settleShorts",
              args: [cdpId],
            })
          : await wallet.writeContract({
              address: protocol.market!,
              abi: creditMarketAbi,
              functionName: "claimShort",
              args: [cdpId, from],
            });
      const rec = await publicClient.waitForTransactionReceipt({ hash });
      setNote(rec.status === "success" ? `${fn === "settleShorts" ? "Settled" : "Claimed"} cell #${cdpId}.` : "Reverted.");
      await shortPack.refetch();
    } catch (e) {
      setNote(txError(e));
    } finally {
      setBusy(null);
    }
  }

  const mySeason = useMemo(() => {
    const rows = seasonBal.data;
    const expected = seasonMarketIds.length * 6;
    if (!rows || rows.length !== expected) return [];
    return seasonMarketIds
      .map((row, i) => {
        const base = i * 6;
        const v = rows[base]?.result as bigint | undefined;
        const f = rows[base + 1]?.result as bigint | undefined;
        const m = rows[base + 2]?.result as
          | readonly [
              bigint,
              Address,
              bigint,
              bigint,
              bigint,
              bigint,
              bigint,
              bigint,
              boolean,
              boolean,
            ]
          | undefined;
        const matOf = rows[base + 3]?.result as bigint | undefined;
        const preview = rows[base + 4]?.result as bigint | undefined;
        const didClaim = Boolean(rows[base + 5]?.result);
        if ((!v || v === 0n) && (!f || f === 0n)) return null;
        const cost = (v ?? 0n) + (f ?? 0n);
        const resolved = Boolean(m?.[8]);
        const verdantWins = Boolean(m?.[9]);
        const mark = resolved ? (preview ?? 0n) : cost;
        const pnl = mark - cost;
        return {
          ...row,
          v: v ?? 0n,
          f: f ?? 0n,
          resolved,
          verdantWins,
          maturity: matOf ?? m?.[3] ?? 0n,
          preview: preview ?? 0n,
          claimed: didClaim,
          cost,
          mark,
          pnl,
        };
      })
      .filter(Boolean);
  }, [seasonMarketIds, seasonBal.data]);

  const seasonPnl = useMemo(
    () => mySeason.reduce((s, r) => s + (r?.pnl ?? 0n), 0n),
    [mySeason],
  );
  const seasonCost = useMemo(
    () => mySeason.reduce((s, r) => s + (r?.cost ?? 0n), 0n),
    [mySeason],
  );
  const noteBal = useMemo(
    () => myNotes.filter((n) => n.active).reduce((s, n) => s + n.held, 0n),
    [myNotes],
  );
  const noteMtm = useMemo(() => {
    const px = mid.markPx > 0n ? mid.markPx : 10n ** 18n;
    return (noteBal * px) / 10n ** 18n;
  }, [noteBal, mid.markPx]);
  const issuedFace = useMemo(
    () => myCells.reduce((s, c) => s + (c && c.isIssuer ? c.cdp.debtAmount : 0n), 0n),
    [myCells],
  );

  async function redeem(cdpId: bigint) {
    setBusy(`redeem-${cdpId}`);
    setNote(null);
    try {
      const { publicClient, wallet } = await getTxClients();
      const hash = await wallet.writeContract({
        address: protocol.token!,
        abi: tokenAbi,
        functionName: "redeem",
        args: [cdpId],
      });
      const rec = await publicClient.waitForTransactionReceipt({ hash });
      setNote(rec.status === "success" ? `Redeemed cell #${cdpId} notes.` : "Redeem reverted.");
      await notesPack.refetch();
    } catch (e) {
      setNote(txError(e));
    } finally {
      setBusy(null);
    }
  }

  const frostCount = myCells.filter((c) => c && c.season === "Frostbite").length;
  const verdantCount = myCells.filter((c) => c && c.season === "Verdant").length;

  if (!SWAP) {
    return (
      <p className="text-sm text-[#E11D48]">Set NEXT_PUBLIC_SWAP to load portfolio.</p>
    );
  }

  if (!isConnected || !address) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-start gap-4 py-10">
        <h1 className="text-2xl font-semibold sm:text-3xl">Portfolio</h1>
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Connect a wallet to see issued debt, notes held, open orders, shorts, and
          season packs — live from Monad testnet.
        </p>
        <button
          type="button"
          onClick={() => openConnectModal?.()}
          className="min-h-11 rounded-full bg-zinc-950 px-5 text-sm font-medium text-white dark:bg-white dark:text-[#0B0F14]"
        >
          Connect wallet
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
            Your book
          </p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Portfolio</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Issued cells, note inventory, maker orders, shorts, and season bets with
            cost / mark / PnL. Notes are marked at P<sub>mid</sub> (last long + last short) / 2.
          </p>
        </div>
        <p className="font-mono text-[11px] text-zinc-500">
          P<sub>mid</sub> {mid.label} · last long {mid.lastLong > 0n ? fromWad(mid.lastLong) : "—"}
          {" "}· last short {mid.lastShort > 0n ? fromWad(mid.lastShort) : "—"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 sm:gap-3">
        <Stat label="USDC" value={fromWad(usdcBal.data ?? 0n, 2)} hint="wallet" />
        <Stat
          label="mMonad MTM"
          value={fromWad(noteMtm, 2)}
          hint={`${fromWad(noteBal, 2)} note @ mark`}
        />
        <Stat
          label="Issued debt"
          value={fromWad(issuedFace, 2)}
          hint="your drawer face"
        />
        <Stat
          label="Cells"
          value={`${myCells.length}`}
          hint={`${verdantCount} Verdant · ${frostCount} Frostbite`}
        />
        <Stat
          label="Season cost"
          value={fromWad(seasonCost, 2)}
          hint="V+F USDC principal"
        />
        <Stat
          label="Season PnL"
          value={pnlLabel(seasonCost + seasonPnl, seasonCost)}
          hint={
            seasonPnl > 0n
              ? "unrealized / claimable"
              : seasonPnl < 0n
                ? "losing / unresolved @ cost"
                : "flat @ cost until resolve"
          }
        />
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Cells</h2>
          <Link href="/cell" className="text-xs text-zinc-500 underline-offset-2 hover:underline">
            Open Cell →
          </Link>
        </div>
        {myCells.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-zinc-200 px-4 py-8 text-center text-sm text-zinc-500 dark:border-white/10">
            No active cells as issuer or note holder.{" "}
            <Link href="/issue" className="underline-offset-2 hover:underline">
              Issue
            </Link>
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {myCells.map((c) => {
              if (!c) return null;
              const frost = c.season === "Frostbite";
              return (
                <article
                  key={c.id.toString()}
                  className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-medium">#{c.id.toString()}</span>
                    <Pill tone={frost ? "red" : "green"}>{c.season}</Pill>
                    {c.isIssuer && <Pill>Issuer</Pill>}
                    {c.isHolder && <Pill tone="amber">Holder · {fromWad(c.held, 2)} mM</Pill>}
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:text-sm">
                    <dt className="text-zinc-500">Collateral</dt>
                    <dd className="text-right font-mono">{fromWad(c.cdp.collateralAmount, 2)} USDC</dd>
                    <dt className="text-zinc-500">Face</dt>
                    <dd className="text-right font-mono">{fromWad(c.cdp.debtAmount, 2)} mM</dd>
                    <dt className="text-zinc-500">Health H = G/(F·P)</dt>
                    <dd className="text-right font-mono">
                      {c.hOn != null ? fromWad(c.hOn, 2) : "—"}{" "}
                      <span className={frost ? "text-[#E11D48]" : "text-[#22C55E]"}>
                        {c.season}
                      </span>
                    </dd>
                  </dl>
                  <Link
                    href={`/season?cdp=${c.id.toString()}`}
                    className="mt-3 inline-block text-xs font-medium text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
                  >
                    Season for #{c.id.toString()} →
                  </Link>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Notes</h2>
        {note && <p className="text-xs text-zinc-600 dark:text-zinc-400">{note}</p>}
        {myNotes.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-zinc-200 px-4 py-6 text-center text-sm text-zinc-500 dark:border-white/10">
            No mMonad notes held. Buy a long on{" "}
            <Link href="/trade" className="underline-offset-2 hover:underline">
              Trade
            </Link>
            .
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {myNotes.map((n) => (
              <article
                key={n.id.toString()}
                className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-4 text-xs dark:border-white/10 dark:bg-white/[0.03] sm:text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-medium">Cell #{n.id.toString()}</span>
                  <Pill tone={n.open ? "green" : n.active ? "neutral" : "amber"}>
                    {n.open ? "Repaid · redeemable" : n.active ? "Live" : "Closed"}
                  </Pill>
                </div>
                <p className="font-mono">
                  {fromWad(n.held, 2)} mM
                  {n.open ? ` → ${fromWad(n.claim, 2)} USDC` : ""}
                </p>
                {n.open ? (
                  <button
                    {...noRestore}
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void redeem(n.id)}
                    className="min-h-10 rounded-full bg-[#22C55E]/15 text-sm font-medium text-[#15803d] disabled:opacity-40 dark:text-[#22C55E]"
                  >
                    {busy === `redeem-${n.id}` ? "Sending…" : "Redeem at par"}
                  </button>
                ) : n.active ? (
                  <Link
                    href="/cell"
                    className="text-xs text-zinc-500 underline-offset-2 hover:underline"
                  >
                    Redeem after maturity on Cell →
                  </Link>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Open orders</h2>
          <Link href="/trade" className="text-xs text-zinc-500 underline-offset-2 hover:underline">
            Trade →
          </Link>
        </div>
        {myOrders.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-zinc-200 px-4 py-6 text-center text-sm text-zinc-500 dark:border-white/10">
            No resting maker orders.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-zinc-200 dark:border-white/10">
            <table className="w-full min-w-[28rem] text-left text-xs sm:text-sm">
              <thead className="border-b border-zinc-200 text-[11px] text-zinc-500 dark:border-white/10">
                <tr>
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Side</th>
                  <th className="px-3 py-2 text-right font-medium">Px</th>
                  <th className="px-3 py-2 text-right font-medium">Size</th>
                  <th className="px-3 py-2 text-right font-medium">Cell</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {myOrders.map((o) => (
                  <tr key={o.id.toString()} className="border-b border-zinc-100 dark:border-white/5">
                    <td className="px-3 py-2">{o.id.toString()}</td>
                    <td className="px-3 py-2">{sideLabel(o.side)}</td>
                    <td className="px-3 py-2 text-right">{fromWad(o.price)}</td>
                    <td className="px-3 py-2 text-right">{fromWad(o.remaining, 2)}</td>
                    <td className="px-3 py-2 text-right">{o.cdpId.toString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Short book</h2>
        <p className="text-xs text-zinc-500">
          Cash-settled on the cell&apos;s note TWAP at maturity (par if the book is thin). Short
          receives 1 − v per unit, writer receives v.
        </p>
        {myShorts.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-zinc-200 px-4 py-6 text-center text-sm text-zinc-500 dark:border-white/10">
            No short-book positions. Sell on the short book to go short, buy to write.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {myShorts.map((s) => {
              const mature = nowSec >= s.matureAt;
              return (
                <article
                  key={s.id.toString()}
                  className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm">Cell #{s.id.toString()}</span>
                    {s.short > 0n && <Pill tone="red">Short {fromWad(s.short, 2)}</Pill>}
                    {s.written > 0n && <Pill tone="green">Writer {fromWad(s.written, 2)}</Pill>}
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <dt className="text-zinc-500">Settlement price</dt>
                    <dd className="text-right font-mono">
                      {s.settled ? fromWad(s.mark, 4) : mature ? "ready to settle" : `at ${stampFromUnix(s.matureAt)}`}
                    </dd>
                    {s.settled && (
                      <>
                        <dt className="text-zinc-500">Payout</dt>
                        <dd className="text-right font-mono">{fromWad(s.payout, 2)} USDC</dd>
                      </>
                    )}
                  </dl>
                  {s.settled ? (
                    <button
                      {...noRestore}
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => void shortTx(`claim-${s.id}`, "claimShort", s.id)}
                      className="min-h-10 rounded-full bg-[#22C55E]/15 text-sm font-medium text-[#15803d] disabled:opacity-40 dark:text-[#22C55E]"
                    >
                      {busy === `claim-${s.id}` ? "Sending…" : `Claim ${fromWad(s.payout, 2)} USDC`}
                    </button>
                  ) : (
                    <button
                      {...noRestore}
                      type="button"
                      disabled={Boolean(busy) || !mature}
                      onClick={() => void shortTx(`settle-${s.id}`, "settleShorts", s.id)}
                      className="min-h-10 rounded-full bg-zinc-950/5 text-sm font-medium disabled:opacity-40 dark:bg-white/10"
                    >
                      {busy === `settle-${s.id}` ? "Sending…" : mature ? "Settle short book" : "Settles at maturity"}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Season</h2>
          <Link href="/season" className="text-xs text-zinc-500 underline-offset-2 hover:underline">
            Season →
          </Link>
        </div>
        {!SEASON_POOL ? (
          <p className="text-sm text-zinc-500">SeasonPool not configured.</p>
        ) : mySeason.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-200 px-4 py-6 text-center text-sm text-zinc-500 dark:border-white/10">
            <p>
              No VERDANT / FROSTBITE packs yet. A Cell CDP is not a Season position until you
              open a market and mint.
            </p>
            {myCells[0] && (
              <p className="mt-2">
                <Link
                  href={`/season?cdp=${myCells[0].id.toString()}`}
                  className="font-medium text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300"
                >
                  Open Season for cell #{myCells[0].id.toString()} →
                </Link>
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {mySeason.map((s) => {
              if (!s) return null;
              return (
                <article
                  key={`${s.cdpId}-${s.mid}`}
                  className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm">Cell #{s.cdpId.toString()}</span>
                    <Pill tone="amber">Market {s.mid.toString()}</Pill>
                    {s.resolved ? (
                      <Pill tone={s.verdantWins ? "green" : "red"}>
                        {s.verdantWins ? "VERDANT won" : "FROSTBITE won"}
                      </Pill>
                    ) : (
                      <Pill>Open</Pill>
                    )}
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <dt className="text-[#22C55E]">VERDANT</dt>
                    <dd className="text-right font-mono">{fromWad(s.v, 2)}</dd>
                    <dt className="text-[#E11D48]">FROSTBITE</dt>
                    <dd className="text-right font-mono">{fromWad(s.f, 2)}</dd>
                    <dt className="text-zinc-500">Cost</dt>
                    <dd className="text-right font-mono">{fromWad(s.cost, 2)} USDC</dd>
                    <dt className="text-zinc-500">Mark</dt>
                    <dd className="text-right font-mono">{fromWad(s.mark, 2)} USDC</dd>
                    <dt className="text-zinc-500">PnL</dt>
                    <dd
                      className={`text-right font-mono ${
                        s.pnl > 0n
                          ? "text-[#22C55E]"
                          : s.pnl < 0n
                            ? "text-[#E11D48]"
                            : ""
                      }`}
                    >
                      {pnlLabel(s.mark, s.cost)}
                      {s.claimed ? " · claimed" : ""}
                    </dd>
                    <dt className="text-zinc-500">Maturity</dt>
                    <dd className="text-right font-mono text-xs">
                      {s.maturity > 0n ? stampFromUnix(s.maturity) : "—"}
                    </dd>
                    {s.resolved && !s.claimed && (
                      <>
                        <dt className="text-zinc-500">Claim preview</dt>
                        <dd className="text-right font-mono">
                          {fromWad(s.preview, 2)} USDC
                          {s.preview === 0n ? " · lost" : ""}
                        </dd>
                      </>
                    )}
                  </dl>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
