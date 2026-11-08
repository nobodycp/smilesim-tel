import type { Prisma } from '../../generated/prisma/client';

// Paging rules shared by the office lists. Everything here is pure: the service hands the
// result to Prisma, so filters and cursors run in the database and never over loaded rows.

export const LINES_PAGE = 30;
export const TASKS_PAGE = 50;
export const FEED_PAGE = 80;
export const NOTICES_PAGE = 40;

export const LINE_STATUSES = ['active', 'frozen', 'disconnected', 'suspended'] as const;
export const TASK_STATUSES = ['pending', 'working', 'done', 'cancelled'] as const;

export const NEWEST_FIRST = [{ createdAt: 'desc' }, { id: 'desc' }] as const;

function oneOf<T extends string>(list: readonly T[], value: string | undefined): T | undefined {
  return list.find((item) => item === value);
}

/** One extra row tells whether another page exists. */
export function pageOf<T extends { id: string }>(rows: T[], size: number): { page: T[]; nextCursor: string | null } {
  const page = rows.slice(0, size);
  return { page, nextCursor: rows.length > size ? page[page.length - 1]?.id ?? null : null };
}

/** Prisma arguments for an id cursor over a list ordered by NEWEST_FIRST. */
export function idCursorArgs(cursor: string | undefined, size: number) {
  return { take: size + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) };
}

/** «ينتهي قريباً»: an active line whose subscription ends within this many days (owner, 2026-11-08). */
export const EXPIRING_DAYS = 3;

/** The window of an expiring line: active, ending between now and EXPIRING_DAYS from now. */
export function expiringWhere(now: Date = new Date()): Prisma.LineWhereInput {
  return { status: 'active', endsAt: { gte: now, lte: new Date(now.getTime() + EXPIRING_DAYS * 86_400_000) } };
}

export type LineFilter = { q?: string; status?: string; packageCode?: string; provider?: string; company?: string };

/**
 * The where clause of the numbers list. `q` searches the number and the serial (spaces removed,
 * so "055 024" finds 055024 and "899 720" finds that serial), plus the package name and the
 * company name. Provider, company, and package narrow the same row together.
 */
export function linesWhere(posIds: string[], filter: LineFilter): Prisma.LineWhereInput {
  const status = oneOf(LINE_STATUSES, filter.status);
  const packageCode = (filter.packageCode ?? '').trim();
  const provider = (filter.provider ?? '').trim();
  const company = (filter.company ?? '').trim();
  const text = (filter.q ?? '').trim();
  const digits = text.replace(/\s/g, '');
  const search: Prisma.LineWhereInput = !text
    ? {}
    : {
        OR: [
          { msisdn: { contains: digits } },
          { iccid: { contains: digits } },
          { package: { name: { contains: text, mode: 'insensitive' } } },
          { package: { company: { name: { contains: text, mode: 'insensitive' } } } },
        ],
      };
  const pack: Prisma.PackageWhereInput = {
    ...(packageCode ? { code: packageCode } : {}),
    ...(provider ? { provider: { name: provider } } : {}),
    ...(company ? { company: { name: company } } : {}),
  };
  return {
    posId: { in: posIds },
    // `expiring` is not a stored status: it narrows the active lines to those ending soon.
    ...(filter.status === 'expiring' ? expiringWhere() : status ? { status } : {}),
    ...(Object.keys(pack).length ? { package: pack } : {}),
    ...search,
  };
}

export function taskStatusOf(value: string | undefined): (typeof TASK_STATUSES)[number] | undefined {
  return oneOf(TASK_STATUSES, value);
}

/** Opaque cursor of a time-ordered list: the createdAt (ms) and id of the last row served. */
export type FeedPosition = { at: Date; id: string };

export function encodeFeedCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.getTime()}~${row.id}`, 'utf8').toString('base64url');
}

/** `undefined` when no cursor was sent, `null` when the one sent is not ours. */
export function decodeFeedCursor(raw: string | undefined): FeedPosition | null | undefined {
  if (!raw) return undefined;
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  const split = text.indexOf('~');
  const ms = Number(text.slice(0, split));
  const id = text.slice(split + 1);
  if (split < 1 || !Number.isFinite(ms) || !id) return null;
  const at = new Date(ms);
  return Number.isNaN(at.getTime()) ? null : { at, id };
}

/** Rows strictly after the cursor under NEWEST_FIRST. Put it inside `AND`. */
export function afterFeed(position: FeedPosition | undefined) {
  return position
    ? [{ OR: [{ createdAt: { lt: position.at } }, { createdAt: position.at, id: { lt: position.id } }] }]
    : [];
}

function newer(a: { createdAt: Date; id: string }, b: { createdAt: Date; id: string }): number {
  const delta = b.createdAt.getTime() - a.createdAt.getTime();
  if (delta !== 0) return delta;
  return a.id === b.id ? 0 : a.id < b.id ? 1 : -1;
}

/**
 * Merges lists that were each read with `size + 1` rows after the same cursor. More rows than
 * `size` after the merge means at least one source has more to give.
 */
export function mergeFeed<T extends { createdAt: Date; id: string }>(
  sources: T[][],
  size: number,
): { page: T[]; nextCursor: string | null } {
  const all = sources.flat().sort(newer);
  const page = all.slice(0, size);
  const last = page[page.length - 1];
  return { page, nextCursor: all.length > size && last ? encodeFeedCursor(last) : null };
}
