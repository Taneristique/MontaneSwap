"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { erc20Abi, type Address } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { cdpAbi, creditMarketAbi, seasonPoolAbi, Side, tokenAbi } from "@/lib/abi";
import { SEASON_POOL, SWAP } from "@/lib/addresses";
import { fromWad, pnlLabel, seasonOf, stampFromUnix } from "@/lib/format";
import { markHealth, useDisplayMid } from "@/lib/use-display-mid";
import { useFillTape } from "@/lib/use-fill-tape";
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
  const mBal = useReadContract({
    address: protocol.token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: monadTestnet.id,
    query: { enabled: Boolean(protocol.token && address), refetchInterval: 5000 },
  });
  const issued = useReadContract({
    address: protocol.token,
    abi: tokenAbi,
    functionName: "issuedDebt",
    args: address ? [address] : undefined,
    chainId: monadTestnet.id,
    query: { enabled: Boolean(protocol.token && address), refetchInterval: 5000 },
  });

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

  const live = useReadContract({
    address: protocol.market,
    abi: creditMarketAbi,
    functionName: "liveBook",
    chainId: monadTestnet.id,
    query: { enabled: Boolean(protocol.market && address), refetchInterval: 4000 },
  });

  const shortPack = useReadContracts({
    contracts: ids.flatMap((id) => [
      {
        address: protocol.market!,
        abi: creditMarketAbi,
        functionName: "shortSize" as const,
        args: [address!, id] as const,
        chainId: monadTestnet.id,
      },
      {
        address: protocol.market!,
        abi: creditMarketAbi,
        functionName: "shortEscrow" as const,
        args: [address!, id] as const,
        chainId: monadTestnet.id,
      },
    ]),
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

  const myCells = useMemo(() => {
    if (!me) return [];
    return ids
      .map((id, i) => {
        const cdp = cellsPack.data?.[i * 2]?.result as Cdp | undefined;
        const hOn = cellsPack.data?.[i * 2 + 1]?.result as bigint | undefined;
        if (!cdp?.active) return null;
        const isIssuer = cdp.issuer.toLowerCase() === me;
        const isLong = cdp.longOwner.toLowerCase() === me;
        if (!isIssuer && !isLong) return null;
        const hMark =
          cdp.debtAmount > 0n
            ? markHealth(cdp.collateralAmount, cdp.debtAmount, mid.markPx > 0n ? mid.markPx : 10n ** 18n)
            : (hOn ?? 0n);
        const season = seasonOf(hMark > 0n ? hMark : (hOn ?? 0n));
        return { id, cdp, hOn, hMark, season, isIssuer, isLong };
      })
      .filter(Boolean);
  }, [ids, cellsPack.data, me, mid.markPx]);

  const myOrders = useMemo(() => {
    if (!me) return [];
    const rows = (live.data ?? []) as Live[];
    return rows.filter((o) => o.maker.toLowerCase() === me && o.remaining > 0n);
  }, [live.data, me]);

  const myShorts = useMemo(() => {
    if (!me) return [];
    return ids
      .map((id, i) => {
        const size = shortPack.data?.[i * 2]?.result as bigint | undefined;
        const escrow = shortPack.data?.[i * 2 + 1]?.result as bigint | undefined;
        if (!size || size === 0n) return null;
        return { id, size, escrow: escrow ?? 0n };
      })
      .filter(Boolean);
  }, [ids, shortPack.data, me]);

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
  const noteMtm = useMemo(() => {
    const bal = mBal.data ?? 0n;
    const px = mid.markPx > 0n ? mid.markPx : 10n ** 18n;
    return (bal * px) / 10n ** 18n;
  }, [mBal.data, mid.markPx]);
  const shortEscrowTotal = useMemo(
    () => myShorts.reduce((s, r) => s + (r?.escrow ?? 0n), 0n),
    [myShorts],
  );

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
          Connect a wallet to see issued debt, long ownership, open orders, shorts, and
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
            cost / mark / PnL. Mark uses live book / last trade.
          </p>
        </div>
        <p className="font-mono text-[11px] text-zinc-500">
          P<sub>mid</sub> {mid.label} · mark {mid.markLabel} ({mid.markSource})
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 sm:gap-3">
        <Stat label="USDC" value={fromWad(usdcBal.data ?? 0n, 2)} hint="wallet" />
        <Stat
          label="mMonad MTM"
          value={fromWad(noteMtm, 2)}
          hint={`${fromWad(mBal.data ?? 0n, 2)} note @ mark`}
        />
        <Stat
          label="Issued debt"
          value={fromWad(issued.data ?? 0n, 2)}
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
      {shortEscrowTotal > 0n && (
        <p className="text-xs text-zinc-500">
          Short escrow locked: {fromWad(shortEscrowTotal, 2)} USDC across {myShorts.length}{" "}
          cell(s).
        </p>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Cells</h2>
          <Link href="/cell" className="text-xs text-zinc-500 underline-offset-2 hover:underline">
            Open Cell →
          </Link>
        </div>
        {myCells.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-zinc-200 px-4 py-8 text-center text-sm text-zinc-500 dark:border-white/10">
            No active cells as issuer or long owner.{" "}
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
                    {c.isLong && <Pill tone="amber">Long owner</Pill>}
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:text-sm">
                    <dt className="text-zinc-500">Collateral</dt>
                    <dd className="text-right font-mono">{fromWad(c.cdp.collateralAmount, 2)} USDC</dd>
                    <dt className="text-zinc-500">Face</dt>
                    <dd className="text-right font-mono">{fromWad(c.cdp.debtAmount, 2)} mM</dd>
                    <dt className="text-zinc-500">H @ mark</dt>
                    <dd className="text-right font-mono">{fromWad(c.hMark, 2)}</dd>
                    <dt className="text-zinc-500">H on-chain</dt>
                    <dd className="text-right font-mono text-zinc-500">
                      {c.hOn != null ? fromWad(c.hOn, 2) : "—"}
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
        <h2 className="text-base font-semibold">Shorts</h2>
        {myShorts.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-zinc-200 px-4 py-6 text-center text-sm text-zinc-500 dark:border-white/10">
            No open short size. Filling a short ask opens synthetic exposure (escrowed USDC).
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {myShorts.map((s) => {
              if (!s) return null;
              return (
                <article
                  key={s.id.toString()}
                  className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">Cell #{s.id.toString()}</span>
                    <Pill tone="red">Short</Pill>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <dt className="text-zinc-500">Size</dt>
                    <dd className="text-right font-mono">{fromWad(s.size, 2)} mM</dd>
                    <dt className="text-zinc-500">Escrow</dt>
                    <dd className="text-right font-mono">{fromWad(s.escrow, 2)} USDC</dd>
                  </dl>
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
