export type Season = "Frostbite" | "Verdant";
export type BookKind = "long" | "short";
export type TakerSide = "buy" | "sell";
export type Resting = "ask" | "bid";

export type BookRow = {
  id: string;
  px: string;
  size: string;
  ts: string;
  maker: string;
  issuer: string;
  f: string;
  g: string;
  h: string;
  season: Season;
};

export type BookSnapshot = {
  pMid: string;
  frozen: boolean;
  longAsks: BookRow[];
  longBids: BookRow[];
  shortAsks: BookRow[];
  shortBids: BookRow[];
};

export type CellRow = {
  id: string;
  issuer: string;
  longOwner: string;
  g: string;
  f: string;
  h: string;
  season: Season;
  huntPending: boolean;
  huntBond: string;
  mature: boolean;
  repaid: boolean;
};

export function bookStamp(iso: string) {
  const hms = iso.slice(11, 19);
  const md = `${iso.slice(5, 7)}-${iso.slice(8, 10)}`;
  return { hms, full: `${md} ${hms}` };
}
