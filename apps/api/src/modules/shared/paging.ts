import { fail } from './office-failure';

// The one list contract (backend-engineering.mdc 4.7). Every list answers `{ items, nextCursor, total }` plus its
// own extra keys, takes `?cursor=` and nothing else, and reads `size + 1` rows so the extra one tells whether
// another page exists. The cursor is opaque to the caller: the time and id of the last row served.

/** No list serves more rows than this in one answer. */
export const PAGE_MAX = 100;

export type Page<Item> = { items: Item[]; nextCursor: string | null; total: number };

export type Position = { at: Date; id: string };

/** The order every cursor-paged list is read in; `after()` assumes it. */
export const NEWEST_FIRST = [{ createdAt: 'desc' }, { id: 'desc' }] as const;

export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.getTime()}~${id}`, 'utf8').toString('base64url');
}

/** `undefined` when no cursor was sent, `null` when the one sent is not ours. */
export function decodeCursor(raw: string | undefined): Position | null | undefined {
  if (!raw) return undefined;
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  const split = text.indexOf('~');
  const ms = Number(text.slice(0, split));
  const id = text.slice(split + 1);
  if (split < 1 || !Number.isFinite(ms) || !id) return null;
  const at = new Date(ms);
  return Number.isNaN(at.getTime()) ? null : { at, id };
}

/** The position a cursor points at; a cursor this API did not issue is 400 INVALID. */
export function cursorPosition(raw: string | undefined): Position | undefined {
  const position = decodeCursor(raw);
  if (position === null) fail(400, 'INVALID');
  return position;
}

/** Rows strictly after the cursor under NEWEST_FIRST, for Prisma's `AND`. `column` is the row's time column. */
export function after<Column extends string = 'createdAt'>(position: Position | undefined, column: Column = 'createdAt' as Column) {
  if (!position) return [];
  return [{ OR: [{ [column]: { lt: position.at } }, { [column]: position.at, id: { lt: position.id } }] }] as [
    { OR: [Record<Column, { lt: Date }>, Record<Column, Date> & { id: { lt: string } }] },
  ];
}

/** One page out of `size + 1` rows read after the cursor. `at` names the row's time when it is not `createdAt`. */
export function page<Row extends { id: string }>(
  rows: Row[],
  size: number,
  at: (row: Row) => Date = (row) => (row as unknown as { createdAt: Date }).createdAt,
): { items: Row[]; nextCursor: string | null } {
  const items = rows.slice(0, size);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > size && last ? encodeCursor(at(last), last.id) : null };
}

/** A cursor over a list paged by a text key (the users table: rank and login). Opaque like the other one. */
export function encodeKeyCursor(key: string): string {
  return Buffer.from(`k~${key}`, 'utf8').toString('base64url');
}

/** `undefined` when no cursor was sent; a cursor that is not a key cursor is 400 INVALID. */
export function keyCursor(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  if (!text.startsWith('k~') || text.length < 3) fail(400, 'INVALID');
  return text.slice(2);
}
