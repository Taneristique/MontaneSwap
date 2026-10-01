import { BaseError, ContractFunctionRevertedError } from "viem";

const REASONS: Record<string, string> = {
  issuer: "Only the cell's issuer wallet can do this. Switch to the issuer account.",
  cell: "Pick a cell first (the order needs a cell id).",
  cdp: "This cell is closed.",
  zero: "Size and price must be positive.",
  InactiveCdp: "This cell is closed.",
  BadOrder: "Order not accepted: short-book price must be below 1.00, and the order must still be live.",
  SelfMatch: "That resting order is yours; use another wallet to trade against it.",
  ShortCap: "Short book for this cell is full (open shorts are capped at half the face).",
  ShortClosed: "Short book for this cell is closed (matured or settled).",
  BookFull: "Book side is full. Try a better price or cancel an old order.",
  Frozen: "Circuit breaker is on; only FOMO orders fill right now.",
  EnforcedPause: "Protocol is paused.",
  NotMaker: "Only the maker can cancel this order.",
  FomoOrder: "FOMO orders are market-owned and cannot be cancelled here.",
  NotMature: "Not mature yet. Clock starts at first sale (else mint) + 24h. Check the countdown on Cell.",
  NotVerdant: "Repay needs Verdant: marked H = G/(F·P_mid) must be > 1.10.",
  NotFrostbite: "Hunt needs Frostbite: marked H = G/(F·P_mid) ≤ 1.10.",
  SpreadTooTight:
    "Price is inside the spread: long orders must be ≥ last short + 0.10, short orders ≤ last long − 0.10.",
  InstantHunt: "Instant liquidate only after maturity (first sale/mint + 24h and ≥3 blocks).",
  HunterSelf: "Issuer cannot hunt their own cell.",
  CDPAlreadyExists:
    "This wallet already issues an active cell (one per address). Hunt from a wallet without a cell, or repay yours first.",
  HuntExists: "A hunt is already pending on this cell.",
  NoHunt: "No hunt pending on this cell.",
  MinRatio: "Collateral too low: H must be at least 1.10 at issue.",
  Cap: "Amount out of range for this cell.",
  TooEarly: "Too early: wait for maturity.",
  NotSettled: "Not settled yet. Press Settle first.",
  NotResolved: "Season not resolved yet. Resolve first.",
  AlreadyClaimed: "Already claimed.",
  Nothing: "Nothing to claim on this wallet.",
  NothingToRedeem: "No notes of this cell on this wallet.",
  RedeemClosed: "Redemption opens after the issuer closes the cell.",
  WindowClosed: "This Season window is closed.",
  Closed: "This market is closed.",
};

function revertReason(e: unknown): string | null {
  if (!(e instanceof BaseError)) return null;
  const rev = e.walk((x) => x instanceof ContractFunctionRevertedError);
  if (!(rev instanceof ContractFunctionRevertedError)) return null;
  const name = rev.data?.errorName;
  const key = name && name !== "Error" ? name : (rev.reason ?? name ?? null);
  if (!key) return null;
  return REASONS[key] ?? key;
}

export function txError(e: unknown) {
  const reason = revertReason(e);
  if (reason) return reason;

  const raw =
    e && typeof e === "object"
      ? String(
          (e as { shortMessage?: string; message?: string }).shortMessage ??
            (e as { message?: string }).message ??
            "",
        )
      : typeof e === "string"
        ? e
        : "";

  const lower = raw.toLowerCase();
  if (lower.includes("keyring")) {
    return "MetaMask cannot sign for this account (Keyring not found). Unlock MetaMask, pick the connected account, or disconnect → reconnect. Not a contract revert.";
  }
  if (lower.includes("user rejected") || lower.includes("user denied")) {
    return "Rejected in wallet.";
  }
  if (lower.includes("insufficient funds")) {
    return "Not enough MON for gas on this wallet.";
  }
  if (raw) return raw;
  return "Rejected.";
}
