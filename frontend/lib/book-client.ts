import { useSyncExternalStore } from "react";
import type { BookSnapshot, CellRow } from "./book-types";

type BookState = BookSnapshot | null;
type CellState = CellRow[] | null;

let book: BookState = null;
let cells: CellState = null;
const bookSubs = new Set<() => void>();
const cellSubs = new Set<() => void>();
let bookOnce = false;
let cellOnce = false;

function emit(subs: Set<() => void>) {
  for (const fn of subs) fn();
}

export async function refreshBook() {
  const res = await fetch("/api/book");
  book = (await res.json()) as BookSnapshot;
  emit(bookSubs);
  return book;
}

export async function refreshCells() {
  const res = await fetch("/api/cell");
  const data = (await res.json()) as { cells: CellRow[] };
  cells = data.cells;
  emit(cellSubs);
  return cells;
}

function subscribeBook(fn: () => void) {
  bookSubs.add(fn);
  if (!bookOnce) {
    bookOnce = true;
    void refreshBook();
  }
  return () => {
    bookSubs.delete(fn);
  };
}

function subscribeCells(fn: () => void) {
  cellSubs.add(fn);
  if (!cellOnce) {
    cellOnce = true;
    void refreshCells();
  }
  return () => {
    cellSubs.delete(fn);
  };
}

export function useBook() {
  return useSyncExternalStore(subscribeBook, () => book, () => null);
}

export function useCells() {
  return useSyncExternalStore(subscribeCells, () => cells, () => null);
}

export function applyBook(next: BookSnapshot) {
  book = next;
  emit(bookSubs);
}

export function applyCells(next: CellRow[]) {
  cells = next;
  emit(cellSubs);
}
