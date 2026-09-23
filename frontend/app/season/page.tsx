"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { type Address } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { cdpAbi, seasonPoolAbi } from "@/lib/abi";
import { SEASON_POOL } from "@/lib/addresses";
import { ensureAllowance } from "@/lib/ensure-usdc";
import { etaFromUnix, fromWad, shortAddr, stampFromUnix, toWad } from "@/lib/format";
import { getTxClients } from "@/lib/tx-clients";
import { txError } from "@/lib/tx-error";
import { useIsClient } from "@/lib/use-is-client";
import { useProtocol } from "@/lib/use-protocol";
import { monadTestnet } from "@/lib/wagmi";

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

export default function SeasonPage() {
  const [cdpId, setCdpId] = useState("1");
  const [each, setEach] = useState("10");
  const [dirAmt, setDirAmt] = useState("10");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 0 until client mount — avoids Date.now() / wagmi SSR vs hydrate disabled mismatch.
  const [nowSec, setNowSec] = useState(0);
  const [qCdp, setQCdp] = useState<string | null>(null);
  const ready = useIsClient();
  const { address, isConnected } = useAccount();
  const protocol = useProtocol();
  const me = address?.toLowerCase() ?? null;

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("cdp");
    if (q?.trim()) {
      setQCdp(q.trim());
      setCdpId(q.trim());
    }
  }, []);

  // Wallet switch: clear notes only — keep browsing any cell; balances re-key on `address`.
  useEffect(() => {
    setNote(null);
    setBusy(false);
  }, [me]);

  useEffect(() => {
    if (!ready) return;
    setNowSec(Math.floor(Date.now() / 1000));
    const tick = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(tick);
  }, [ready]);

  const id = useMemo(() => {
    try {
      return BigInt(cdpId.trim() || "0");
    } catch {
      return 0n;
    }
  }, [cdpId]);

  const nextCdpId = useReadContract({
    address: protocol.position,
    abi: cdpAbi,
    functionName: "nextId",
    chainId: monadTestnet.id,
    query: { enabled: Boolean(protocol.position), refetchInterval: 8000 },
  });
  const lastCdp = Number(nextCdpId.data ?? 0n);
  const allCdpIds = useMemo(
    () => Array.from({ length: Math.min(lastCdp, 128) }, (_, i) => BigInt(i + 1)),
    [lastCdp],
  );

  const nextMarketId = useReadContract({
    address: SEASON_POOL,
    abi: seasonPoolAbi,
    functionName: "nextMarketId",
    chainId: monadTestnet.id,
    query: { enabled: Boolean(SEASON_POOL), refetchInterval: 5000 },
  });
  const lastMid = Number(nextMarketId.data ?? 1n);
  const allMids = useMemo(
    () => Array.from({ length: Math.max(0, Math.min(lastMid - 1, 64)) }, (_, i) => BigInt(i + 1)),
    [lastMid],
  );

  const allMarketsPack = useReadContracts({
    contracts: allMids.flatMap((mId) => [
      {
        address: SEASON_POOL!,
        abi: seasonPoolAbi,
        functionName: "markets" as const,
        args: [mId] as const,
        chainId: monadTestnet.id,
      },
      {
        address: SEASON_POOL!,
        abi: seasonPoolAbi,
        functionName: "maturityOf" as const,
        args: [mId] as const,
        chainId: monadTestnet.id,
      },
    ]),
    query: {
      enabled: Boolean(SEASON_POOL) && allMids.length > 0,
      refetchInterval: 5000,
      staleTime: 0,
      placeholderData: undefined,
      structuralSharing: false,
    },
  });

  const openMarkets = useMemo(() => {
    const rows = allMarketsPack.data;
    // markets + maturityOf per mid
    if (!rows || rows.length !== allMids.length * 2) return [];
    return allMids
      .map((mId, i) => {
        const m = rows[i * 2]?.result as
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
        const matOf = rows[i * 2 + 1]?.result as bigint | undefined;
        if (!m || m[0] === 0n) return null;
        return {
          marketId: mId,
          cdpId: m[0],
          issuer: m[1],
          maturity: matOf ?? m[3],
          vSupply: m[4],
          fSupply: m[5],
          resolved: Boolean(m[8]),
          verdantWins: Boolean(m[9]),
        };
      })
      .filter(Boolean);
  }, [allMids, allMarketsPack.data]);

  const myPosPack = useReadContracts({
    contracts: openMarkets.flatMap((row) => {
      const mId = row!.marketId;
      return [
        {
          address: SEASON_POOL!,
          abi: seasonPoolAbi,
          functionName: "verdantOf" as const,
          args: [mId, address!] as const,
          chainId: monadTestnet.id,
        },
        {
          address: SEASON_POOL!,
          abi: seasonPoolAbi,
          functionName: "frostbiteOf" as const,
          args: [mId, address!] as const,
          chainId: monadTestnet.id,
        },
      ];
    }),
    query: {
      enabled: Boolean(SEASON_POOL && address && openMarkets.length > 0),
      refetchInterval: 4000,
      staleTime: 0,
      placeholderData: undefined,
      structuralSharing: false,
    },
  });

  const myPositions = useMemo(() => {
    if (!address) return [];
    const rows = myPosPack.data;
    const expected = openMarkets.length * 2;
    if (!rows || rows.length !== expected) return [];
    return openMarkets
      .map((row, i) => {
        if (!row) return null;
        const v = (rows[i * 2]?.result as bigint | undefined) ?? 0n;
        const f = (rows[i * 2 + 1]?.result as bigint | undefined) ?? 0n;
        if (v === 0n && f === 0n) return null;
        return { ...row, v, f };
      })
      .filter(Boolean);
  }, [openMarkets, myPosPack.data, address]);

  const cellsPack = useReadContracts({
    contracts: allCdpIds.map((cid) => ({
      address: protocol.position!,
      abi: cdpAbi,
      functionName: "getCDP" as const,
      args: [cid] as const,
      chainId: monadTestnet.id,
    })),
    query: {
      enabled: Boolean(protocol.position) && allCdpIds.length > 0,
      refetchInterval: 8000,
    },
  });

  const myCellIds = useMemo(() => {
    if (!me) return [] as bigint[];
    return allCdpIds.filter((cid, i) => {
      const cdp = cellsPack.data?.[i]?.result as Cdp | undefined;
      if (!cdp?.active || cdp.debtAmount === 0n) return false;
      return cdp.issuer.toLowerCase() === me || cdp.longOwner.toLowerCase() === me;
    });
  }, [allCdpIds, cellsPack.data, me]);

  const myCellsMarket = useReadContracts({
    contracts: myCellIds.map((cid) => ({
      address: SEASON_POOL!,
      abi: seasonPoolAbi,
      functionName: "marketOfCdp" as const,
      args: [cid] as const,
      chainId: monadTestnet.id,
    })),
    query: {
      enabled: Boolean(SEASON_POOL) && myCellIds.length > 0,
      refetchInterval: 5000,
      staleTime: 0,
      placeholderData: undefined,
      structuralSharing: false,
    },
  });

  const myCellsNeedingMarket = useMemo(() => {
    const rows = myCellsMarket.data;
    if (!rows || rows.length !== myCellIds.length) return [] as bigint[];
    return myCellIds.filter((cid, i) => {
      const mId = (rows[i]?.result as bigint | undefined) ?? 0n;
      return mId === 0n;
    });
  }, [myCellIds, myCellsMarket.data]);

  const marketId = useReadContract({
    address: SEASON_POOL,
    abi: seasonPoolAbi,
    functionName: "marketOfCdp",
    args: [id],
    chainId: monadTestnet.id,
    query: {
      enabled: Boolean(SEASON_POOL && id > 0n),
      refetchInterval: 4000,
      staleTime: 0,
      placeholderData: undefined,
    },
  });

  const mid = id > 0n && marketId.data && marketId.data > 0n ? marketId.data : 0n;

  const market = useReadContract({
    address: SEASON_POOL,
    abi: seasonPoolAbi,
    functionName: "markets",
    args: [mid],
    chainId: monadTestnet.id,
    query: { enabled: Boolean(SEASON_POOL && mid > 0n), refetchInterval: 4000 },
  });

  const maturityOnChain = useReadContract({
    address: SEASON_POOL,
    abi: seasonPoolAbi,
    functionName: "maturityOf",
    args: [mid],
    chainId: monadTestnet.id,
    query: { enabled: Boolean(SEASON_POOL && mid > 0n), refetchInterval: 4000 },
  });

  const dirOpen = useReadContract({
    address: SEASON_POOL,
    abi: seasonPoolAbi,
    functionName: "directionalOpen",
    args: [mid],
    chainId: monadTestnet.id,
    query: { enabled: Boolean(SEASON_POOL && mid > 0n), refetchInterval: 4000 },
  });

  const health = useReadContract({
    address: protocol.position,
    abi: cdpAbi,
    functionName: "health",
    args: [id],
    chainId: monadTestnet.id,
    query: {
      enabled: Boolean(protocol.position && id > 0n),
      refetchInterval: 5000,
    },
  });

  const myV = useReadContract({
    address: SEASON_POOL,
    abi: seasonPoolAbi,
    functionName: "verdantOf",
    args: address ? [mid, address] : undefined,
    chainId: monadTestnet.id,
    query: {
      enabled: Boolean(SEASON_POOL && mid > 0n && address),
      refetchInterval: 4000,
      staleTime: 0,
      placeholderData: undefined,
    },
  });
  const myF = useReadContract({
    address: SEASON_POOL,
    abi: seasonPoolAbi,
    functionName: "frostbiteOf",
    args: address ? [mid, address] : undefined,
    chainId: monadTestnet.id,
    query: {
      enabled: Boolean(SEASON_POOL && mid > 0n && address),
      refetchInterval: 4000,
      staleTime: 0,
      placeholderData: undefined,
    },
  });
  const preview = useReadContract({
    address: SEASON_POOL,
    abi: seasonPoolAbi,
    functionName: "previewClaim",
    args: address ? [mid, address] : undefined,
    chainId: monadTestnet.id,
    query: {
      enabled: Boolean(SEASON_POOL && mid > 0n && address),
      refetchInterval: 4000,
      staleTime: 0,
      placeholderData: undefined,
    },
  });
  const claimed = useReadContract({
    address: SEASON_POOL,
    abi: seasonPoolAbi,
    functionName: "claimed",
    args: address ? [mid, address] : undefined,
    chainId: monadTestnet.id,
    query: {
      enabled: Boolean(SEASON_POOL && mid > 0n && address),
      refetchInterval: 4000,
      staleTime: 0,
      placeholderData: undefined,
    },
  });

  const m = market.data;
  const resolved = Boolean(m?.[8]);
  const verdantWins = Boolean(m?.[9]);
  // Cell-aligned clock (firstSaleAt || openedAt + MATURITY) — not the stored snapshot alone.
  const maturity = maturityOnChain.data ?? m?.[3] ?? 0n;
  const openedAt = m?.[2] ?? 0n;
  const dirDeadline = openedAt > 0n ? openedAt + 12n * 3600n : 0n;
  const pastMaturity =
    ready && nowSec > 0 && maturity > 0n && BigInt(nowSec) >= maturity;
  const packOpen = ready && mid > 0n && !resolved && !pastMaturity;
  const canResolve = ready && mid > 0n && !resolved && pastMaturity;
  const winBal = verdantWins ? (myV.data ?? 0n) : (myF.data ?? 0n);
  const canClaim =
    ready &&
    mid > 0n &&
    resolved &&
    !claimed.data &&
    (preview.data ?? 0n) > 0n &&
    winBal > 0n;
  const cost = (myV.data ?? 0n) + (myF.data ?? 0n);
  const mark = resolved ? (preview.data ?? 0n) : cost;
  const pnl = mark - cost;

  const hLabel = health.data != null ? fromWad(health.data) : "—";
  const seasonNow =
    health.data == null ? "—" : health.data > 1100000000000000000n ? "Verdant" : "Frostbite";

  async function run(label: string, fn: () => Promise<void>) {
    if (!isConnected) {
      setNote("Connect a wallet on Monad testnet.");
      return;
    }
    if (!SEASON_POOL) {
      setNote("SeasonPool address missing.");
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      await fn();
      setNote(label);
      await Promise.all([
        marketId.refetch(),
        market.refetch(),
        myV.refetch(),
        myF.refetch(),
        dirOpen.refetch(),
        preview.refetch(),
        claimed.refetch(),
        nextMarketId.refetch(),
        allMarketsPack.refetch(),
        myPosPack.refetch(),
        myCellsMarket.refetch(),
      ]);
    } catch (e) {
      setNote(txError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
          Satellite · not the CLOB
        </p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Season</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Anyone can bet on any cell’s Season market (V/F). You do not need to own the cell.
          Open a market on a cell that has none yet, then mint. Your positions update per
          wallet.
        </p>
      </div>

      {!SEASON_POOL && (
        <p className="rounded-2xl border border-zinc-300 px-4 py-3 text-sm text-zinc-600 dark:border-white/15 dark:text-zinc-400">
          Set <code className="font-mono text-xs">NEXT_PUBLIC_SEASON_POOL</code> to the
          deployed SeasonPool.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Open markets · bet on any
          </p>
          {openMarkets.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">
              No Season markets yet. Open one on any active cell id below.
            </p>
          ) : (
            <ul className="mt-3 flex max-h-48 flex-col gap-2 overflow-y-auto">
              {openMarkets.map((row) => {
                if (!row) return null;
                const selected = id === row.cdpId;
                return (
                  <li key={row.marketId.toString()}>
                    <button
                      type="button"
                      onClick={() => setCdpId(row.cdpId.toString())}
                      className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm ${
                        selected
                          ? "bg-zinc-950 text-white dark:bg-white dark:text-[#0B0F14]"
                          : "hover:bg-zinc-950/5 dark:hover:bg-white/10"
                      }`}
                    >
                      <span className="font-mono">
                        Cell #{row.cdpId.toString()} · mkt {row.marketId.toString()}
                      </span>
                      <span className={`text-[11px] ${selected ? "opacity-80" : "text-zinc-500"}`}>
                        {row.resolved
                          ? row.verdantWins
                            ? "VERDANT won"
                            : "FROSTBITE won"
                          : `V ${fromWad(row.vSupply, 0)} · F ${fromWad(row.fSupply, 0)}`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Your positions {!ready || !me ? "· connect" : ""}
          </p>
          {!ready || !address ? (
            <p className="mt-3 text-sm text-zinc-500">Connect to see V/F you hold.</p>
          ) : myPositions.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">
              No packs on this wallet. Pick an open market and mint.
            </p>
          ) : (
            <ul className="mt-3 flex max-h-48 flex-col gap-2 overflow-y-auto">
              {myPositions.map((row) => {
                if (!row) return null;
                return (
                  <li key={`pos-${row.marketId}`}>
                    <button
                      type="button"
                      onClick={() => setCdpId(row.cdpId.toString())}
                      className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-zinc-950/5 dark:hover:bg-white/10"
                    >
                      <span className="font-mono">Cell #{row.cdpId.toString()}</span>
                      <span className="font-mono text-[11px] text-zinc-500">
                        V {fromWad(row.v, 2)} · F {fromWad(row.f, 2)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {myCellsNeedingMarket.length > 0 && (
            <div className="mt-4 border-t border-zinc-100 pt-3 dark:border-white/5">
              <p className="text-[11px] text-zinc-500">Your cells without a market</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {myCellsNeedingMarket.map((cid) => (
                  <button
                    key={cid.toString()}
                    type="button"
                    onClick={() => setCdpId(cid.toString())}
                    className="rounded-full border border-zinc-200 px-2.5 py-1 text-[11px] dark:border-white/10"
                  >
                    Open #{cid.toString()}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 dark:border-white/10 dark:bg-white/[0.03]">
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-zinc-500">Cell id (any active cdpId)</span>
            <input
              value={cdpId}
              inputMode="numeric"
              onChange={(e) => setCdpId(e.target.value)}
              className="min-h-11 rounded-xl border border-zinc-200 bg-transparent px-4 py-3 font-mono text-base outline-none dark:border-white/10"
            />
          </label>
          {openMarkets.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {openMarkets.slice(0, 12).map((row) => {
                if (!row) return null;
                return (
                  <button
                    key={`chip-${row.marketId}`}
                    type="button"
                    onClick={() => setCdpId(row.cdpId.toString())}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                      id === row.cdpId
                        ? "bg-zinc-950 text-white dark:bg-white dark:text-[#0B0F14]"
                        : "border border-zinc-200 text-zinc-600 dark:border-white/10 dark:text-zinc-400"
                    }`}
                  >
                    #{row.cdpId.toString()}
                  </button>
                );
              })}
            </div>
          )}

          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-zinc-500">H on-chain</dt>
              <dd className="font-mono">{hLabel}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Cell health season</dt>
              <dd className={seasonNow === "Frostbite" ? "text-[#E11D48]" : "text-[#22C55E]"}>
                {seasonNow}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Season market</dt>
              <dd className="font-mono">{mid > 0n ? mid.toString() : "not opened"}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Directional 12h</dt>
              <dd>
                {dirOpen.data
                  ? `open · ${etaFromUnix(dirDeadline, nowSec)}`
                  : mid > 0n
                    ? "closed"
                    : "—"}
              </dd>
            </div>
          </dl>

          {mid === 0n && id > 0n && (
            <p className="mt-3 text-xs leading-5 text-zinc-500">
              New cells open a Season market on mint. Legacy cells: anyone can open here
              (you need not own the cell). Maturity follows the cell clock
              (openedAt / firstSaleAt + 1d).
            </p>
          )}

          <button
            type="button"
            disabled={!ready || busy || !SEASON_POOL || mid > 0n || id === 0n}
            onClick={() =>
              void run("Market opened.", async () => {
                const { publicClient, wallet } = await getTxClients();
                const hash = await wallet.writeContract({
                  address: SEASON_POOL!,
                  abi: seasonPoolAbi,
                  functionName: "openMarket",
                  args: [id],
                });
                await publicClient.waitForTransactionReceipt({ hash });
              })
            }
            className="mt-5 min-h-11 w-full rounded-full bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-[#0B0F14]"
          >
            {mid > 0n ? "Market already open" : "Open season market (legacy)"}
          </button>

          <label className="mt-4 flex flex-col gap-2 text-sm">
            <span className="text-zinc-500">Directional amount (1 USDC = 1 token)</span>
            <input
              value={dirAmt}
              onChange={(e) => setDirAmt(e.target.value)}
              className="min-h-11 rounded-xl border border-zinc-200 bg-transparent px-4 py-3 font-mono outline-none dark:border-white/10"
            />
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!ready || busy || !SEASON_POOL || mid === 0n || !dirOpen.data}
              onClick={() =>
                void run("Minted VERDANT.", async () => {
                  const amt = toWad(dirAmt);
                  const { publicClient, wallet, address: from } = await getTxClients();
                  await ensureAllowance({
                    publicClient,
                    wallet,
                    token: protocol.usdc!,
                    owner: from,
                    spender: SEASON_POOL!,
                    need: amt,
                  });
                  const hash = await wallet.writeContract({
                    address: SEASON_POOL!,
                    abi: seasonPoolAbi,
                    functionName: "mintDirectional",
                    args: [mid, true, amt],
                  });
                  await publicClient.waitForTransactionReceipt({ hash });
                })
              }
              className="min-h-11 rounded-full bg-[#22C55E] text-sm font-medium text-[#0B0F14] disabled:opacity-40"
            >
              Buy VERDANT
            </button>
            <button
              type="button"
              disabled={!ready || busy || !SEASON_POOL || mid === 0n || !dirOpen.data}
              onClick={() =>
                void run("Minted FROSTBITE.", async () => {
                  const amt = toWad(dirAmt);
                  const { publicClient, wallet, address: from } = await getTxClients();
                  await ensureAllowance({
                    publicClient,
                    wallet,
                    token: protocol.usdc!,
                    owner: from,
                    spender: SEASON_POOL!,
                    need: amt,
                  });
                  const hash = await wallet.writeContract({
                    address: SEASON_POOL!,
                    abi: seasonPoolAbi,
                    functionName: "mintDirectional",
                    args: [mid, false, amt],
                  });
                  await publicClient.waitForTransactionReceipt({ hash });
                })
              }
              className="min-h-11 rounded-full bg-[#E11D48]/90 text-sm font-medium text-white disabled:opacity-40"
            >
              Buy FROSTBITE
            </button>
          </div>
          {!dirOpen.data && mid > 0n && (
            <p className="mt-2 text-[11px] text-zinc-500">
              Directional window closed (12h after cell open). Use hedge pack until maturity.
            </p>
          )}

          <label className="mt-4 flex flex-col gap-2 text-sm">
            <span className="text-zinc-500">Pack each side (e.g. 10 → 10V+10F = $20)</span>
            <input
              value={each}
              onChange={(e) => setEach(e.target.value)}
              className="min-h-11 rounded-xl border border-zinc-200 bg-transparent px-4 py-3 font-mono outline-none dark:border-white/10"
            />
          </label>
          <button
            type="button"
            disabled={busy || !SEASON_POOL || !packOpen}
            onClick={() =>
              void run("Hedge pack minted.", async () => {
                const n = toWad(each);
                const { publicClient, wallet, address: from } = await getTxClients();
                await ensureAllowance({
                  publicClient,
                  wallet,
                  token: protocol.usdc!,
                  owner: from,
                  spender: SEASON_POOL!,
                  need: n * 2n,
                });
                const hash = await wallet.writeContract({
                  address: SEASON_POOL!,
                  abi: seasonPoolAbi,
                  functionName: "mintPack",
                  args: [mid, n],
                });
                await publicClient.waitForTransactionReceipt({ hash });
              })
            }
            className="mt-2 min-h-11 w-full rounded-full border border-zinc-200 text-sm font-medium disabled:opacity-40 dark:border-white/10"
          >
            {!packOpen && mid > 0n
              ? pastMaturity || resolved
                ? "Pack closed"
                : "Mint hedge pack"
              : "Mint hedge pack"}
          </button>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 dark:border-white/10 dark:bg-white/[0.03]">
          {m && mid > 0n ? (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-zinc-500">Issuer</dt>
                <dd className="font-mono text-xs">{shortAddr(m[1])}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Maturity</dt>
                <dd className="font-mono text-xs">
                  {stampFromUnix(maturity)}
                  <span className="mt-0.5 block text-zinc-500">
                    {pastMaturity ? "mature" : `in ${etaFromUnix(maturity, nowSec)}`}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">VERDANT supply</dt>
                <dd className="font-mono">{fromWad(m[4], 2)}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">FROSTBITE supply</dt>
                <dd className="font-mono">{fromWad(m[5], 2)}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Status</dt>
                <dd>
                  {resolved
                    ? verdantWins
                      ? "Resolved · VERDANT"
                      : "Resolved · FROSTBITE"
                    : pastMaturity
                      ? "Mature · await resolve"
                      : "Open"}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Your bal</dt>
                <dd className="font-mono text-xs">
                  V {fromWad(myV.data ?? 0n, 2)} · F {fromWad(myF.data ?? 0n, 2)}
                </dd>
              </div>
              {cost > 0n && (
                <>
                  <div>
                    <dt className="text-zinc-500">Cost / mark</dt>
                    <dd className="font-mono text-xs">
                      {fromWad(cost, 2)} / {fromWad(mark, 2)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">PnL (USDC)</dt>
                    <dd
                      className={`font-mono text-xs ${
                        pnl > 0n
                          ? "text-[#22C55E]"
                          : pnl < 0n
                            ? "text-[#E11D48]"
                            : ""
                      }`}
                    >
                      {pnl > 0n ? "+" : pnl < 0n ? "−" : ""}
                      {fromWad(pnl < 0n ? -pnl : pnl, 2)}
                      {claimed.data ? " · claimed" : ""}
                    </dd>
                  </div>
                </>
              )}
              {resolved && (
                <div className="col-span-2">
                  <dt className="text-zinc-500">Preview claim</dt>
                  <dd className="font-mono">
                    {claimed.data
                      ? "Already claimed"
                      : (preview.data ?? 0n) > 0n
                        ? `${fromWad(preview.data ?? 0n, 2)} USDC`
                        : "0 · losing side / nothing to claim"}
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <div className="space-y-3 text-sm text-zinc-500">
              <p>No Season market for cell #{id > 0n ? id.toString() : "—"} yet.</p>
              <p>
                Issuing a cell does not auto-open Season. Use{" "}
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  Open season market
                </span>{" "}
                on the left.
              </p>
              <p>
                <Link href="/cell" className="underline-offset-2 hover:underline">
                  ← Back to Cell
                </Link>
              </p>
            </div>
          )}

          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              disabled={busy || !SEASON_POOL || !canResolve}
              onClick={() =>
                void run("Resolved.", async () => {
                  const { publicClient, wallet } = await getTxClients();
                  const hash = await wallet.writeContract({
                    address: SEASON_POOL!,
                    abi: seasonPoolAbi,
                    functionName: "resolve",
                    args: [mid],
                  });
                  await publicClient.waitForTransactionReceipt({ hash });
                })
              }
              className="min-h-11 rounded-full border border-zinc-200 text-sm font-medium disabled:opacity-40 dark:border-white/10"
            >
              {resolved
                ? "Already resolved"
                : pastMaturity
                  ? "Resolve at maturity"
                  : `Resolve in ${etaFromUnix(maturity, nowSec)}`}
            </button>
            <button
              type="button"
              disabled={busy || !SEASON_POOL || !canClaim}
              onClick={() =>
                void run("Claimed.", async () => {
                  const { publicClient, wallet } = await getTxClients();
                  const hash = await wallet.writeContract({
                    address: SEASON_POOL!,
                    abi: seasonPoolAbi,
                    functionName: "claim",
                    args: [mid],
                  });
                  await publicClient.waitForTransactionReceipt({ hash });
                })
              }
              className="min-h-11 rounded-full bg-zinc-950 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-[#0B0F14]"
            >
              {claimed.data
                ? "Claimed"
                : resolved && (preview.data ?? 0n) === 0n
                  ? "Nothing to claim"
                  : "Claim winnings"}
            </button>
          </div>
        </div>
      </div>

      {note && <p className="text-sm text-zinc-600 dark:text-zinc-400">{note}</p>}
    </div>
  );
}
