import { NextResponse } from "next/server";
import { getMarketTape } from "@/lib/tape-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    const tape = await getMarketTape(force);
    return NextResponse.json(
      {
        market: tape.market,
        tradeCount: tape.tradeCount,
        fills: tape.fills,
        fetchedAt: tape.at,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "tape failed";
    return NextResponse.json({ error: msg, fills: [], tradeCount: 0 }, { status: 500 });
  }
}
