/** Cache-busted mark — Ama Dablam on red|green square. */
const LOGO_SRC = "/montane-swap-icon-v2.png";

export function Logo({ size = 36 }: { size?: number; clipId?: string }) {
  return (
    // Plain img avoids Next optimizer serving a stale resized brand asset.
    <img
      src={LOGO_SRC}
      alt="Montane Swap"
      width={size}
      height={size}
      className="shrink-0"
      style={{ aspectRatio: "1 / 1", width: size, height: size }}
      decoding="async"
    />
  );
}
