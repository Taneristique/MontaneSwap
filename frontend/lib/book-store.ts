import type { BookKind, BookRow, BookSnapshot, CellRow, Season, TakerSide } from "./book-types";

type Store = {
  seq: number;
  longAsks: BookRow[];
  longBids: BookRow[];
  shortAsks: BookRow[];
  shortBids: BookRow[];
  cells: CellRow[];
};

function seedCells(): CellRow[] {
  return [
    {
      id: "c1",
      issuer: "Mateo",
      longOwner: "Mateo",
      g: "111",
      f: "100",
      h: "1.11",
      season: "Verdant",
      huntPending: false,
      huntBond: "0",
      mature: false,
      repaid: false,
    },
    {
      id: "c2",
      issuer: "Mateo",
      longOwner: "Eve",
      g: "110",
      f: "100",
      h: "1.10",
      season: "Frostbite",
      huntPending: true,
      huntBond: "70",
      mature: false,
      repaid: false,
    },
  ];
}

const mateo = {
  issuer: "Mateo",
  f: "100",
  g: "111",
  h: "1.11",
  season: "Verdant" as const,
};

function row(
  id: string,
  maker: string,
  px: string,
  size: string,
  ts: string,
  extra: Partial<BookRow> = {},
): BookRow {
  return { id, maker, px, size, ts, ...mateo, ...extra };
}

function seed(): Store {
  return {
    seq: 5,
    longAsks: [row("1", "Mateo", "1.005", "50", "2026-09-10T21:47:12Z")],
    longBids: [row("2", "Alice", "1.000", "25", "2026-09-10T21:46:08Z")],
    shortAsks: [row("3", "Mateo", "0.995", "50", "2026-09-10T21:47:12Z")],
    shortBids: [
      row("4", "Elif", "1.010", "50", "2026-09-10T21:47:04Z"),
      row("5", "Mete", "1.020", "25", "2026-09-10T21:43:01Z"),
    ],
    cells: seedCells(),
  };
}

const g = globalThis as unknown as { __montaneBook?: Store };
if (!g.__montaneBook) g.__montaneBook = seed();
else if (!g.__montaneBook.cells) g.__montaneBook.cells = seedCells();

function store() {
  return g.__montaneBook!;
}

function bestBid(rows: BookRow[]) {
  return [...rows].sort((a, b) => Number(b.px) - Number(a.px))[0];
}

function pMid(): string {
  const lb = bestBid(store().longBids);
  const sb = bestBid(store().shortBids);
  if (!lb || !sb) return "1.000";
  return ((Number(lb.px) + Number(sb.px)) / 2).toFixed(3);
}

export function snapshot(): BookSnapshot {
  const s = store();
  return {
    pMid: pMid(),
    frozen: false,
    longAsks: s.longAsks,
    longBids: s.longBids,
    shortAsks: s.shortAsks,
    shortBids: s.shortBids,
  };
}

export function listCells(): CellRow[] {
  return store().cells;
}

export function reset() {
  g.__montaneBook = seed();
  return snapshot();
}

export function take(book: BookKind, side: TakerSide, sizeIn: number, maker: string) {
  if (!(sizeIn > 0)) return { error: "Size must be positive." };
  const s = store();
  const asks = book === "long" ? s.longAsks : s.shortAsks;
  const bids = book === "long" ? s.longBids : s.shortBids;
  const resting = side === "buy" ? asks : bids;
  const sort = side === "buy"
    ? (a: BookRow, b: BookRow) => Number(a.px) - Number(b.px)
    : (a: BookRow, b: BookRow) => Number(b.px) - Number(a.px);

  resting.sort(sort);
  let left = sizeIn;
  let notional = 0;
  const fills: { px: string; size: number; maker: string }[] = [];
  const next: BookRow[] = [];

  for (const o of resting) {
    const avail = Number(o.size);
    if (left <= 0) {
      next.push(o);
      continue;
    }
    const takeAmt = Math.min(avail, left);
    notional += takeAmt * Number(o.px);
    fills.push({ px: o.px, size: takeAmt, maker: o.maker });
    left -= takeAmt;
    const remain = avail - takeAmt;
    if (remain > 1e-9) next.push({ ...o, size: remain.toFixed(0) });
  }

  if (side === "buy") {
    if (book === "long") s.longAsks = next;
    else s.shortAsks = next;
  } else if (book === "long") s.longBids = next;
  else s.shortBids = next;

  if (left > 1e-9) {
    s.seq += 1;
    const restPx = fills[0]?.px ?? (side === "buy" ? "1.000" : "1.005");
    const posted: BookRow = row(
      String(s.seq),
      maker,
      restPx,
      left.toFixed(0),
      new Date().toISOString(),
    );
    if (side === "buy") {
      if (book === "long") s.longBids = [...s.longBids, posted];
      else s.shortBids = [...s.shortBids, posted];
    } else if (book === "long") s.longAsks = [...s.longAsks, posted];
    else s.shortAsks = [...s.shortAsks, posted];
  }

  const fee = notional * 0.0005;
  return {
    book,
    side,
    fills,
    leftover: left,
    feeBps: 5,
    feeUsdc: Number(fee.toFixed(6)),
    note: "Same book only. Alice 1.00 and Elif 1.01 do not cross.",
    snapshot: snapshot(),
  };
}

function findCell(id: string) {
  return store().cells.find((c) => c.id === id);
}

export function mint(input: {
  g: number;
  f: number;
  roll: boolean;
  issuer: string;
}) {
  const { g: G, f: F, roll, issuer } = input;
  if (!(G > 0) || !(F > 0)) return { error: "G and F must be positive." };
  const fee = F * (roll ? 0.0001 : 0.0025);
  if (G <= fee) return { error: "Collateral does not cover the fee." };
  const net = G - fee;
  const h = net / F;
  const season: Season = h > 1.1 ? "Verdant" : "Frostbite";
  const s = store();
  s.seq += 1;
  const id = `c${s.seq}`;
  const cell: CellRow = {
    id,
    issuer,
    longOwner: issuer,
    g: net.toFixed(2),
    f: F.toFixed(0),
    h: h.toFixed(2),
    season,
    huntPending: false,
    huntBond: "0",
    mature: false,
    repaid: false,
  };
  s.cells = [cell, ...s.cells];
  const ts = new Date().toISOString();
  const extra = {
    issuer,
    f: cell.f,
    g: cell.g,
    h: cell.h,
    season,
  };
  s.seq += 1;
  s.longAsks = [
    ...s.longAsks,
    row(String(s.seq), issuer, "1.005", cell.f, ts, extra),
  ];
  s.seq += 1;
  s.shortAsks = [
    ...s.shortAsks,
    row(String(s.seq), issuer, "0.995", cell.f, ts, extra),
  ];
  return {
    cell,
    feeUsdc: Number(fee.toFixed(4)),
    note: "Seeded long 1.005 and short 0.995. Same-book only.",
    snapshot: snapshot(),
  };
}

export function requestHunt(id: string) {
  const c = findCell(id);
  if (!c) return { error: "Cell not found." };
  if (c.repaid) return { error: "Cell already repaid." };
  if (c.season !== "Frostbite") return { error: "Hunt is Frostbite only." };
  if (c.huntPending) return { error: "Hunt already requested." };
  c.huntPending = true;
  c.huntBond = (Number(c.f) * Number(pMid())).toFixed(0);
  return { cell: c, note: "Request locked. Not an instant novation." };
}

export function resolveHunt(id: string) {
  const c = findCell(id);
  if (!c) return { error: "Cell not found." };
  if (!c.huntPending) return { error: "No hunt request." };
  if (Number(c.h) > 1.1) {
    c.huntPending = false;
    c.huntBond = "0";
    c.mature = true;
    return { cell: c, note: "Healthy after maturity. Bond slashed to issuer." };
  }
  c.longOwner = "Hunter";
  c.huntPending = false;
  c.huntBond = "0";
  c.mature = true;
  return { cell: c, note: "Frostbite after maturity. Cell novated." };
}

export function repay(id: string) {
  const c = findCell(id);
  if (!c) return { error: "Cell not found." };
  if (c.repaid) return { error: "Already repaid." };
  if (c.season === "Frostbite") return { error: "Repay is Verdant only." };
  if (c.huntPending) return { error: "Hunt is pending." };
  const s = store();
  const drop = (rows: BookRow[]) =>
    rows.filter((o) => !(o.issuer === c.issuer && o.f === c.f && o.maker === c.issuer));
  s.longAsks = drop(s.longAsks);
  s.shortAsks = drop(s.shortAsks);
  c.repaid = true;
  return {
    cell: c,
    note: "Off-book. Unsold seed returned. Shorts covered from escrow. No walk.",
    snapshot: snapshot(),
  };
}
