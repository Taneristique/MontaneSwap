import { NextResponse } from "next/server";
import { reset, snapshot, take } from "@/lib/book-store";
import type { BookKind, TakerSide } from "@/lib/book-types";

export function GET() {
  return NextResponse.json(snapshot());
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    action?: string;
    book?: string;
    side?: string;
    size?: string | number;
    maker?: string;
  };
  if (body.action === "reset") {
    return NextResponse.json({ snapshot: reset() });
  }
  const book = body.book;
  const side = body.side;
  if (book !== "long" && book !== "short") {
    return NextResponse.json({ error: "Book is long or short." }, { status: 400 });
  }
  if (side !== "buy" && side !== "sell") {
    return NextResponse.json({ error: "Side is buy or sell." }, { status: 400 });
  }
  const size = Number(body.size);
  const result = take(book as BookKind, side as TakerSide, size, body.maker ?? "You");
  if ("error" in result && result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}
