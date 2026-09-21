import { formatUnits, parseUnits, type Address } from "viem";

export function fromWad(x: bigint, digits = 3) {
  const n = Number(formatUnits(x, 18));
  if (!Number.isFinite(n)) return formatUnits(x, 18);
  return n.toFixed(digits);
}

export function toWad(s: string) {
  return parseUnits(s.trim() || "0", 18);
}

export function shortAddr(a: Address | string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** Local wall-clock parts from unix seconds. */
function localParts(sec: bigint | number) {
  const d = new Date(Number(sec) * 1000);
  if (!Number.isFinite(d.getTime())) return null;
  return {
    d,
    dd: pad2(d.getDate()),
    mm: pad2(d.getMonth() + 1),
    yy: String(d.getFullYear()).slice(-2),
    hh: pad2(d.getHours()),
    mi: pad2(d.getMinutes()),
    ss: pad2(d.getSeconds()),
  };
}

/** DD/MM/YY HH:mm:ss — browser local time (not UTC). */
export function stampFromUnix(sec: bigint | number) {
  const p = localParts(sec);
  if (!p) return "—";
  return `${p.dd}/${p.mm}/${p.yy} ${p.hh}:${p.mi}:${p.ss}`;
}

/** Same local clock for book rows (was UTC MM-DD). */
export function utcFromUnix(sec: bigint) {
  const p = localParts(sec);
  if (!p) return { iso: "", hms: "—", full: "—" };
  const iso = p.d.toISOString();
  const hms = `${p.hh}:${p.mi}:${p.ss}`;
  const full = `${p.dd}/${p.mm}/${p.yy} ${hms}`;
  return { iso, hms, full };
}

export function seasonOf(h: bigint) {
  return h > 1100000000000000000n ? "Verdant" : "Frostbite";
}

/** Human countdown from unix seconds → now (sec). */
export function etaFromUnix(targetSec: bigint | number, nowSec?: number) {
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  const t = Number(targetSec);
  if (!Number.isFinite(t)) return "—";
  const d = Math.floor(t - now);
  if (d <= 0) return "now";
  const h = Math.floor(d / 3600);
  const m = Math.floor((d % 3600) / 60);
  const s = d % 60;
  if (h > 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Signed PnL string from wad amounts (mark − cost). */
export function pnlLabel(mark: bigint, cost: bigint, digits = 2) {
  const d = mark - cost;
  const sign = d > 0n ? "+" : d < 0n ? "−" : "";
  const abs = d < 0n ? -d : d;
  return `${sign}${fromWad(abs, digits)}`;
}
