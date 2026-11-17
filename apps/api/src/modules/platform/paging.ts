import { fail } from './api-failure';

// The one list contract (backend-engineering.mdc 4.7). Every list answers `{ items, nextCursor, total, totalCapped }`
// plus its own extra keys, takes `?cursor=` and nothing else, and reads `size + 1` rows so the extra one tells whether
// another page exists. The cursor is opaque to the caller: the time and id of the last row served.

// The page size of each list.
export const LINES_PAGE = 30;
export const TASKS_PAGE = 50;
export const FEED_PAGE = 80;
export const NOTICES_PAGE = 40;
/** The balances report and the wallets list: one short row an account, in the tree's order (by login). */
export const BALANCES_PAGE = 200;

/**
 * A list's `total` is counted up to this many rows (spec 2026-11-17-scale-speed-cleanup, decision 2; database plan
 * DB.8): counting a whole filter took seconds at 2M numbers / 6M ledger entries (audit 2026-11-17, L1c, W1c).
 */
export const TOTAL_CAP = 10_000;

/** How many rows a list's filter holds, up to the cap. `totalCapped: true` says there are more; `total` is then the cap. */
export type Total = { total: number; totalCapped: boolean };

export type Page<Item> = { items: Item[]; nextCursor: string | null } & Total;

/** A count already in hand (a list read whole, a grouped count) under the same contract as `countUpTo`. */
export function cappedTotal(count: number, cap = TOTAL_CAP): Total {
  return count > cap ? { total: cap, totalCapped: true } : { total: count, totalCapped: false };
}

/**
 * A list's `total`, counted up to the cap. `count` is the list's own Prisma `count({ where, orderBy, take })` with the
 * `take` handed to it (`cap + 1`) and the order its page is read in. Prisma 7 sends a limited count as
 * `SELECT COUNT(*) FROM (SELECT id FROM … WHERE … ORDER BY … LIMIT $take OFFSET 0) AS sub`, so the database stops at
 * `cap + 1` rows. The order matters: without one Prisma orders the subquery by `id ASC`, which sorts every matching
 * row or walks the primary key; the page's own order lets the index that serves the page stop the count
 * (`paging.db.spec.ts` keeps the captured SQL and its plan).
 */
export async function countUpTo(count: (take: number) => Promise<number>, cap = TOTAL_CAP): Promise<Total> {
  return cappedTotal(await count(cap + 1), cap);
}

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

/**
 * Rows strictly after the cursor under NEWEST_FIRST, for Prisma's `AND`. `column` is the row's time column.
 * Written `column <= X AND (column < X OR id < Y)`, the same rows as `column < X OR (column = X AND id < Y)`: the
 * first condition gives the index on (column DESC, id DESC) a bound to start from, which the `OR` alone does not
 * (audit 2026-11-17, section 4.3: a deep page 2.96 s → 0.06 ms).
 */
export function after<Column extends string = 'createdAt'>(position: Position | undefined, column: Column = 'createdAt' as Column) {
  if (!position) return [];
  return [{ [column]: { lte: position.at } }, { OR: [{ [column]: { lt: position.at } }, { id: { lt: position.id } }] }] as [
    Record<Column, { lte: Date }>,
    { OR: [Record<Column, { lt: Date }>, { id: { lt: string } }] },
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

/**
 * One page of a list that is already in its order and whose rows carry a unique text key (accounts by login). The
 * cursor names the last row served; when that row is gone the page starts at the first key after it.
 */
export function keyPage<Row>(rows: Row[], size: number, cursor: string | undefined, keyOf: (row: Row) => string): Page<Row> {
  const last = keyCursor(cursor);
  const at = last === undefined ? -1 : rows.findIndex((row) => keyOf(row) === last);
  const next = last !== undefined && at < 0 ? rows.findIndex((row) => keyOf(row) > last) : at + 1;
  const from = next < 0 ? rows.length : next;
  const items = rows.slice(from, from + size);
  const tail = items[items.length - 1];
  return { items, nextCursor: from + size < rows.length && tail ? encodeKeyCursor(keyOf(tail)) : null, ...cappedTotal(rows.length) };
}

/**
 * A short list served whole (the catalog: packages, companies, offers, roles) stops here. It is read with
 * `take: LIST_CAP + 1` and answers `capped: true` when it was cut, so a caller never mistakes a part for the whole.
 */
export const LIST_CAP = 1000;

export function capList<Row>(rows: Row[], limit = LIST_CAP): { rows: Row[]; capped: boolean } {
  return { rows: rows.slice(0, limit), capped: rows.length > limit };
}
