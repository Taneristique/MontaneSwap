import { NextResponse } from "next/server";
import { listCells, mint, repay, requestHunt, resolveHunt } from "@/lib/book-store";

export function GET() {
  return NextResponse.json({ cells: listCells() });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    action?: string;
    id?: string;
    g?: string | number;
    f?: string | number;
    roll?: boolean;
    issuer?: string;
  };

  if (body.action === "mint") {
    const result = mint({
      g: Number(body.g),
      f: Number(body.f),
      roll: Boolean(body.roll),
      issuer: body.issuer ?? "You",
    });
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json(result);
  }

  if (!body.id) {
    return NextResponse.json({ error: "Cell id required." }, { status: 400 });
  }

  const result =
    body.action === "requestHunt"
      ? requestHunt(body.id)
      : body.action === "resolveHunt"
        ? resolveHunt(body.id)
        : body.action === "repay"
          ? repay(body.id)
          : { error: "Action is mint, requestHunt, resolveHunt, or repay." };

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}
