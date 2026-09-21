"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { type Address } from "viem";
import { useBlockNumber, useReadContract, useReadContracts } from "wagmi";
import { cdpAbi, managerAbi } from "@/lib/abi";
import { SWAP } from "@/lib/addresses";
import { ensureAllowance } from "@/lib/ensure-usdc";
import { fromWad, seasonOf, stampFromUnix } from "@/lib/format";
import { getTxClients } from "@/lib/tx-clients";
import { txError } from "@/lib/tx-error";
import { markHealth, useDisplayMid } from "@/lib/use-display-mid";
import { useFillTape } from "@/lib/use-fill-tape";
import { useNnsName } from "@/lib/use-nns-name";
import { useProtocol } from "@/lib/use-protocol";
import { monadTestnet } from "@/lib/wagmi";

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

function useNowSec() {
  const [now, setNow] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
  useEffect(() => {
    const id = window.setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
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

  const cells = ids
    .map((id, i) => {
      const cdp = pack.data?.[i * 3]?.result as Cdp | undefined;
      const h = pack.data?.[i * 3 + 1]?.result as bigint | undefined;
      const hunt = pack.data?.[i * 3 + 2]?.result;
      if (!cdp?.active) return null;
      const hOn = h as bigint | undefined;
      const hMark =
        cdp.debtAmount > 0n
          ? markHealth(
              cdp.collateralAmount,
              cdp.debtAmount,
              mid.markPx > 0n ? mid.markPx : 10n ** 18n,
            )
          : (hOn ?? 0n);
      // Hunt / repay gates use on-chain G/F — same as the contract.
      const seasonOn = hOn != null && hOn > 0n ? seasonOf(hOn) : "Verdant";
      const seasonMark = hMark > 0n ? seasonOf(hMark) : "Verdant";
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
      return {
        id,
        cdp,
        h: hMark,
        hOn,
        seasonOn,
        seasonMark,
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
      await Promise.all([pack.refetch(), nextId.refetch(), tape.refetch()]);
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
          Hunt uses on-chain H = G/F (Frostbite ≤ 1.10), not mark. During 24h: request
          locks bond. After maturity: instant liquidateCDP. If H ≤ 1.00, Winter levy (1%)
          is charged on top of B.
        </p>
        <p className="mt-2 font-mono text-xs text-zinc-500">
          P<sub>mid</sub> {mid.label} · mark {mid.markLabel} ({mid.markSource})
          {mid.lastLabel ? ` · last ${mid.lastLabel}` : ""}
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
        return (
          <section key={c.id.toString()} className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-3 rounded-2xl border border-zinc-200 bg-white p-5 text-sm dark:border-white/10 dark:bg-white/[0.03]">
              <dt className="text-zinc-500">Issuer</dt>
              <dd className="text-right font-medium">
                <Named address={c.cdp.issuer} />
              </dd>
              <dt className="text-zinc-500">Long owner</dt>
              <dd className="text-right font-medium">
                <Named address={c.cdp.longOwner} />
              </dd>
              <dt className="text-zinc-500">Collateral</dt>
              <dd className="text-right font-mono">{fromWad(c.cdp.collateralAmount, 2)} USDC</dd>
              <dt className="text-zinc-500">Face</dt>
              <dd className="text-right font-mono">{fromWad(c.cdp.debtAmount, 0)} mMonad</dd>
              <dt className="text-zinc-500">H @ mark</dt>
              <dd className="text-right font-mono">
                {c.h != null && c.h > 0n ? fromWad(c.h, 4) : "—"}{" "}
                <span className="text-zinc-500">
                  (<Season name={c.seasonMark} />)
                </span>
              </dd>
              <dt className="text-zinc-500">H on-chain (gate)</dt>
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
                        `On-chain H is ${c.hOn != null ? fromWad(c.hOn, 2) : "—"} (need ≤ 1.10). Mark season can differ.`,
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
                type="button"
                disabled={Boolean(busy) || frostOn || c.huntPending || !c.mature}
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
                  : !c.mature
                    ? `Repay · wait ${formatRemain(c.remain)}`
                    : frostOn
                      ? "Repay · Verdant only (on-chain)"
                      : "Repay · issuer, Verdant, off-book"}
              </button>
              <button
                type="button"
                disabled
                className="min-h-12 rounded-full bg-zinc-950/5 py-3 text-sm font-medium text-zinc-500 dark:bg-white/10"
              >
                Withdraw · up to collateral or mark
              </button>
              <Link
                href={`/season?cdp=${c.id.toString()}`}
                className="min-h-12 rounded-full border border-zinc-200 py-3 text-center text-sm font-medium text-zinc-700 dark:border-white/10 dark:text-zinc-300"
              >
                Season · open / mint for cell #{c.id.toString()}
              </Link>
            </div>
          </section>
        );
      })}
    </div>
  );
}
