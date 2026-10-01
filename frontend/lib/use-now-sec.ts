"use client";

import { useEffect, useState } from "react";

/** Wall clock in unix seconds, ticking every second. */
export function useNowSec() {
  const [now, setNow] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
  useEffect(() => {
    const id = window.setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}
