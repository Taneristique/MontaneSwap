export type { BookRow, Season, BookSnapshot, CellRow } from "./book-types";
export { bookStamp } from "./book-types";
export { snapshot as seedBook, listCells } from "./book-store";

export const BOOK = {
  pMid: "1.005",
  frozen: false,
};
