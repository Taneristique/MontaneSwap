"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { type Address } from "viem";
import { useAccount, useBlockNumber, useReadContract, useReadContracts } from "wagmi";
import { cdpAbi, managerAbi, seasonPoolAbi, tokenAbi } from "@/lib/abi";
import { SEASON_POOL, SWAP } from "@/lib/addresses";
import { ensureAllowance } from "@/lib/ensure-usdc";
import { fromWad, seasonOf, stampFromUnix } from "@/lib/format";
import { getTxClients } from "@/lib/tx-clients";
import { txError } from "@/lib/tx-error";
import { useDisplayMid } from "@/lib/use-display-mid";
import { useFillTape } from "@/lib/use-fill-tape";
import { useNnsName } from "@/lib/use-nns-name";
import { useNowSec } from "@/lib/use-now-sec";
import { useProtocol } from "@/lib/use-protocol";
import { monadTestnet } from "@/lib/wagmi";
import { noRestore } from "@/lib/no-restore";

const DAY = 86400n;
const PAR = 10n ** 18n;
const MIN_BLOCKS = 3n;
const WINTER_BPS = 100n; // 1% when H <= PAR

function Season({ name }: { name: string }) {
  const frost = name === "Frostbite";
  return (
    <span className={frost ? "text-[#E11D48]" : "text-[#22C55E]"}>{name}</span>
  );
}

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

function Named({ address }: { address: Address }) {
  const name = useNnsName(address);
  return <>{name}</>;
}

function maturityStart(cdp: Cdp) {
  return cdp.firstSaleAt > 0n ? cdp.firstSaleAt : cdp.openedAt;
}

function formatRemain(sec: bigint) {
  if (sec <= 0n) return "mature";
  const s = Number(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h}h ${m}m ${r}s`;
}

export default function CellPage() {
  const protocol = useProtocol();
  const { address: account } = useAccount();
  const me = account?.toLowerCase();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const tape = useFillTape(protocol.market);
  const mid = useDisplayMid(protocol.market, tape.lastPrice);
  const now = useNowSec();
  const block = useBlockNumber({
    chainId: monadTestnet.id,
    watch: true,
    query: { refetchInterval: 2000 },
  });

  const nextId = useReadContract({
    address: protocol.position,
    abi: cdpAbi,
    functionName: "nextId",
    chainId: monadTestnet.id,
    query: { enabled: Boolean(protocol.position), refetchInterval: 4000 },
  });

  const last = Number(nextId.data ?? 0n);
  const ids = useMemo(() => Array.from({ length: last }, (_, i) => BigInt(i + 1)), [last]);

  const pack = useReadContracts({
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
      {
        address: protocol.manager!,
        abi: managerAbi,
        functionName: "huntRequest" as const,
        args: [id] as const,
        chainId: monadTestnet.id,
      },
    ]),
    query: {
      enabled: Boolean(protocol.position && protocol.manager) && ids.length > 0,
      refetchInterval: 4000,
    },
  });

  const held = useReadContracts({
    contracts: ids.map((id) => ({
      address: protocol.token!,
      abi: tokenAbi,
      functionName: "balanceOf" as const,
      args: [account!, id] as const,
      chainId: monadTestnet.id,
    })),
    query: { enabled: Boolean(protocol.token && account) && ids.length > 0, refetchInterval: 4000 },
  });

  const seasonIds = useReadContracts({
    contracts: ids.map((id) => ({
      address: SEASON_POOL!,
      abi: seasonPoolAbi,
      functionName: "marketOfCdp" as const,
      args: [id] as const,
      chainId: monadTestnet.id,
    })),
    query: { enabled: Boolean(SEASON_POOL) && ids.length > 0, refetchInterval: 8000 },
  });
  const seasonMids = ids.map((_, i) => (seasonIds.data?.[i]?.result as bigint | undefined) ?? 0n);
  const seasonMarkets = useReadContracts({
    contracts: seasonMids
      .filter((m) => m > 0n)
      .map((m) => ({
        address: SEASON_POOL!,
        abi: seasonPoolAbi,
        functionName: "markets" as const,
        args: [m] as const,
        chainId: monadTestnet.id,
      })),
    query: {
      enabled: Boolean(SEASON_POOL) && seasonMids.some((m) => m > 0n),
      refetchInterval: 8000,
    },
  });
  const seasonResolved = new Map<bigint, { verdantWins: boolean }>();
  seasonMids
    .filter((m) => m > 0n)
    .forEach((m, j) => {
      const row = seasonMarkets.data?.[j]?.result as readonly unknown[] | undefined;
      if (row && row[8]) seasonResolved.set(m, { verdantWins: Boolean(row[9]) });
    });

  const cells = ids
    .map((id, i) => {
      const cdp = pack.data?.[i * 3]?.result as Cdp | undefined;
      const h = pack.data?.[i * 3 + 1]?.result as bigint | undefined;
      const hunt = pack.data?.[i * 3 + 2]?.result;
      if (!cdp?.active) return null;
      const hOn = h as bigint | undefined;
      const seasonOn = hOn != null && hOn > 0n ? seasonOf(hOn) : "Verdant";
      const huntPending = Array.isArray(hunt)
        ? Boolean(hunt[2])
        : Boolean((hunt as { pending?: boolean } | undefined)?.pending);
      const huntBond = Array.isArray(hunt)
        ? (hunt[1] as bigint)
        : ((hunt as { bond?: bigint } | undefined)?.bond ?? 0n);
      const start = maturityStart(cdp);
      const matureAt = start + DAY;
      const timeRemain = matureAt > now ? matureAt - now : 0n;
      const blockOk =
        block.data != null ? block.data >= cdp.openBlock + MIN_BLOCKS : timeRemain === 0n;
      const mature = timeRemain === 0n && blockOk;
      const seasonMid = seasonMids[i] ?? 0n;
      const settled = seasonResolved.get(seasonMid);
      const seasonLink =
        seasonMid === 0n
          ? `Season · open / mint for cell #${id}`
          : settled
            ? `Season #${seasonMid} · settled (${settled.verdantWins ? "Verdant" : "Frostbite"} won)`
            : `Season #${seasonMid} · mint / resolve for cell #${id}`;
      const mine = (held.data?.[i]?.result as bigint | undefined) ?? 0n;
      return {
        id,
        cdp,
        mine,
        seasonLink,
        hOn,
        seasonOn,
        huntPending,
        huntBond,
        matureAt,
        remain: timeRemain,
        mature,
        blockOk,
      };
    })
    .filter(Boolean);

  async function send(key: string, fn: () => Promise<void>) {
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
    setBusy(key);
    setNote(null);
    try {
      await fn();
      await Promise.all([pack.refetch(), nextId.refetch(), tape.refetch(), held.refetch()]);
    } catch (e) {
      setNote(txError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">Cell</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Health H = G / (F × P<sub>mid</sub>), marked to the mMonad price (Frostbite ≤ 1.10).
          Long buys raise P<sub>mid</sub> and lower H; shorts do the opposite. During 24h: request
          locks bond. After maturity: instant liquidateCDP. If H ≤ 1.00, Winter levy (1%) is
          charged on top of B.
        </p>
        <p className="mt-2 font-mono text-xs text-zinc-500">
          P<sub>mid</sub> {mid.label} · last long {mid.lastLong > 0n ? fromWad(mid.lastLong) : "—"} ·
          last short {mid.lastShort > 0n ? fromWad(mid.lastShort) : "—"}
        </p>
        {!SWAP && (
          <p className="mt-2 text-xs text-[#E11D48]">Set NEXT_PUBLIC_SWAP.</p>
        )}
        {note && (
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{note}</p>
        )}
      </div>
      {cells.length === 0 && SWAP && (
        <p className="text-sm text-zinc-500">
          {pack.isFetching || nextId.isFetching
            ? "Loading cells…"
            : "No active cells on this deployment."}
        </p>
      )}
      {cells.map((c) => {
        if (!c) return null;
        const frostOn = c.seasonOn === "Frostbite";
        const mark = mid.markPx > 0n ? mid.markPx : mid.px > 0n ? mid.px : 10n ** 18n;
        const bond =
          c.cdp.debtAmount > 0n ? (c.cdp.debtAmount * mark) / 10n ** 18n : c.cdp.debtAmount;
        const winterFee =
          c.hOn != null && c.hOn <= PAR ? (bond * WINTER_BPS) / 10_000n : 0n;
        const usdcNeed = bond + winterFee;
        const canHunt = frostOn || c.huntPending;
        const isIssuer = me != null && c.cdp.issuer.toLowerCase() === me;
        const retireAmt = c.mine < c.cdp.debtAmount ? c.mine : c.cdp.debtAmount - 1n;
        const redeemOut =
          c.cdp.collateralAmount >= c.cdp.debtAmount
            ? c.mine
            : (c.mine * c.cdp.collateralAmount) / c.cdp.debtAmount;
        return (
          <section key={c.id.toString()} className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-3 rounded-2xl border border-zinc-200 bg-white p-5 text-sm dark:border-white/10 dark:bg-white/[0.03]">
              <dt className="text-zinc-500">Issuer</dt>
              <dd className="text-right font-medium">
                <Named address={c.cdp.issuer} />
              </dd>
              <dt className="text-zinc-500">Last buyer</dt>
              <dd className="text-right font-medium">
                <Named address={c.cdp.longOwner} />
              </dd>
              {c.mine > 0n && (
                <>
                  <dt className="text-zinc-500">Your notes</dt>
                  <dd className="text-right font-mono">{fromWad(c.mine, 2)} mMonad</dd>
                </>
              )}
              <dt className="text-zinc-500">Collateral</dt>
              <dd className="text-right font-mono">{fromWad(c.cdp.collateralAmount, 2)} USDC</dd>
              <dt className="text-zinc-500">Face</dt>
              <dd className="text-right font-mono">{fromWad(c.cdp.debtAmount, 0)} mMonad</dd>
              <dt className="text-zinc-500">Health H = G/(F·P)</dt>
              <dd className="text-right font-mono">
                {c.hOn != null ? fromWad(c.hOn, 4) : "—"}{" "}
                <Season name={c.seasonOn} />
              </dd>
              <dt className="text-zinc-500">Frostbite line</dt>
              <dd className="text-right font-mono text-xs text-zinc-500">
                H ≤ 1.10 → hunt · H &gt; 1.10 → Verdant
              </dd>
              <dt className="text-zinc-500">Mature at</dt>
              <dd className="text-right font-mono text-xs">{stampFromUnix(c.matureAt)}</dd>
              <dt className="text-zinc-500">Countdown</dt>
              <dd className={`text-right font-mono text-xs ${c.mature ? "text-[#22C55E]" : ""}`}>
                {c.mature
                  ? "mature"
                  : !c.blockOk && c.remain === 0n
                    ? "wait ≥3 blocks"
                    : formatRemain(c.remain)}
              </dd>
              {c.huntPending && (
                <>
                  <dt className="text-zinc-500">Hunt request</dt>
                  <dd className="text-right font-mono">{fromWad(c.huntBond, 2)} USDC locked</dd>
                </>
              )}
              {winterFee > 0n && frostOn && (
                <>
                  <dt className="text-zinc-500">Winter levy</dt>
                  <dd className="text-right font-mono text-[#E11D48]">
                    +{fromWad(winterFee, 2)} USDC (H≤1)
                  </dd>
                </>
              )}
            </dl>
            <div className="flex flex-col gap-3">
              <button
                {...noRestore}
                type="button"
                disabled={Boolean(busy) || !canHunt}
                onClick={() =>
                  void send(`hunt-${c.id}`, async () => {
                    const { publicClient, wallet, address: from } = await getTxClients();
                    if (c.huntPending) {
                      if (!c.mature) {
                        setNote(
                          `Hunt locked until maturity (${formatRemain(c.remain)}).`,
                        );
                        return;
                      }
                      const hash = await wallet.writeContract({
                        address: protocol.manager!,
                        abi: managerAbi,
                        functionName: "resolveHunt",
                        args: [c.id],
                      });
                      await publicClient.waitForTransactionReceipt({ hash });
                      setNote("Hunt resolved.");
                      return;
                    }
                    if (!frostOn) {
                      setNote(
                        `On-chain H is ${c.hOn != null ? fromWad(c.hOn, 2) : "—"} (need ≤ 1.10).`,
                      );
                      return;
                    }
                    await ensureAllowance({
                      publicClient,
                      wallet,
                      token: protocol.usdc!,
                      owner: from,
                      spender: protocol.manager!,
                      need: usdcNeed,
                    });
                    if (c.mature) {
                      const hash = await wallet.writeContract({
                        address: protocol.manager!,
                        abi: managerAbi,
                        functionName: "liquidateCDP",
                        args: [c.id, bond],
                      });
                      await publicClient.waitForTransactionReceipt({ hash });
                      setNote(
                        winterFee > 0n
                          ? `Instant novation + Winter ${fromWad(winterFee, 2)} USDC.`
                          : "Instant hunt (liquidateCDP) confirmed.",
                      );
                      return;
                    }
                    const hash = await wallet.writeContract({
                      address: protocol.manager!,
                      abi: managerAbi,
                      functionName: "requestHunt",
                      args: [c.id, bond],
                    });
                    await publicClient.waitForTransactionReceipt({ hash });
                    setNote("Hunt requested. Bond locked until maturity.");
                  })
                }
                className="min-h-12 rounded-full bg-[#E11D48]/15 py-3 text-sm font-medium text-[#E11D48] disabled:opacity-40"
              >
                {busy === `hunt-${c.id}`
                  ? "Sending…"
                  : c.huntPending
                    ? c.mature
                      ? "Hunt · resolve now"
                      : `Hunt · resolve in ${formatRemain(c.remain)}`
                    : !frostOn
                      ? "Hunt · need on-chain Frostbite"
                      : c.mature
                        ? "Hunt · instant liquidate"
                        : "Hunt · request, lock B"}
              </button>
              <button
                {...noRestore}
                type="button"
                disabled={Boolean(busy) || !isIssuer || frostOn || c.huntPending || !c.mature}
                onClick={() =>
                  void send(`repay-${c.id}`, async () => {
                    const { publicClient, wallet } = await getTxClients();
                    const hash = await wallet.writeContract({
                      address: protocol.manager!,
                      abi: managerAbi,
                      functionName: "repayCDP",
                      args: [c.id],
                    });
                    await publicClient.waitForTransactionReceipt({ hash });
                    setNote("Repaid off-book.");
                  })
                }
                className="min-h-12 rounded-full bg-[#22C55E]/15 py-3 text-sm font-medium text-[#15803d] disabled:opacity-40 dark:text-[#22C55E]"
              >
                {busy === `repay-${c.id}`
                  ? "Sending…"
                  : !isIssuer
                    ? "Repay · issuer wallet only"
                    : !c.mature
                    ? `Repay · wait ${formatRemain(c.remain)}`
                    : frostOn
                      ? "Repay · Verdant only (on-chain)"
                      : "Repay · issuer, Verdant, off-book"}
              </button>
              {c.mine > 0n && (
                <button
                  {...noRestore}
                  type="button"
                  disabled={Boolean(busy) || !c.mature}
                  onClick={() =>
                    void send(`redeem-${c.id}`, async () => {
                      const { publicClient, wallet } = await getTxClients();
                      const hash = await wallet.writeContract({
                        address: protocol.manager!,
                        abi: managerAbi,
                        functionName: "redeemMatured",
                        args: [c.id, c.mine],
                      });
                      await publicClient.waitForTransactionReceipt({ hash });
                      setNote(`Redeemed ${fromWad(c.mine, 2)} notes.`);
                    })
                  }
                  className="min-h-12 rounded-full bg-zinc-950/5 py-3 text-sm font-medium text-zinc-800 disabled:opacity-40 dark:bg-white/10 dark:text-zinc-200"
                >
                  {busy === `redeem-${c.id}`
                    ? "Sending…"
                    : c.mature
                      ? `Redeem ${fromWad(c.mine, 2)} notes → ${fromWad(redeemOut, 2)} USDC`
                      : `Redeem at par · after maturity (${formatRemain(c.remain)})`}
                </button>
              )}
              {isIssuer && retireAmt > 0n && (
                <button
                  {...noRestore}
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void send(`retire-${c.id}`, async () => {
                      const { publicClient, wallet } = await getTxClients();
                      const hash = await wallet.writeContract({
                        address: protocol.manager!,
                        abi: managerAbi,
                        functionName: "retire",
                        args: [c.id, retireAmt],
                      });
                      await publicClient.waitForTransactionReceipt({ hash });
                      setNote(`Retired ${fromWad(retireAmt, 2)} notes. Face shrinks, H rises.`);
                    })
                  }
                  className="min-h-12 rounded-full bg-zinc-950/5 py-3 text-sm font-medium text-zinc-800 disabled:opacity-40 dark:bg-white/10 dark:text-zinc-200"
                >
                  {busy === `retire-${c.id}`
                    ? "Sending…"
                    : `Retire · burn ${fromWad(retireAmt, 2)} bought-back notes`}
                </button>
              )}
              <Link
                href={`/season?cdp=${c.id.toString()}`}
                className="min-h-12 rounded-full border border-zinc-200 py-3 text-center text-sm font-medium text-zinc-700 dark:border-white/10 dark:text-zinc-300"
              >
                {c.seasonLink}
              </Link>
            </div>
          </section>
        );
      })}
    </div>
  );
}
