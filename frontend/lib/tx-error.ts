export function txError(e: unknown) {
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
  if (lower.includes("notmature") || lower.includes("0x8ac6f563")) {
    return "Not mature yet. Clock starts at first sale (else mint) + 24h. Check the countdown on Cell.";
  }
  if (lower.includes("notverdant")) {
    return "Repay needs Verdant: on-chain H (G/F) must be > 1.10.";
  }
  if (lower.includes("notfrostbite")) {
    return "Hunt needs Frostbite: on-chain H (G/F) ≤ 1.10. Mark health can differ — check H on-chain on Cell.";
  }
  if (lower.includes("instanthunt")) {
    return "Instant liquidate only after maturity (first sale/mint + 24h and ≥3 blocks).";
  }
  if (lower.includes("hunterself")) {
    return "Issuer cannot hunt their own cell.";
  }
  if (lower.includes("user rejected") || lower.includes("user denied")) {
    return "Rejected in wallet.";
  }
  if (raw) return raw;
  return "Rejected.";
}
