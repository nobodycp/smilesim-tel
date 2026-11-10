import type { Prisma } from '../../../generated/prisma/client';

// Page sizes and filters of the office lists (the cursor and the envelope live in shared/paging.ts). Everything
// here is pure: the service hands the result to Prisma, so filters run in the database and never over loaded rows.

export const LINES_PAGE = 30;
export const TASKS_PAGE = 50;
export const FEED_PAGE = 80;
export const NOTICES_PAGE = 40;
/** The balances report and the wallets list: one short row an account, in the tree's order (by login). */
export const BALANCES_PAGE = 200;

export const LINE_STATUSES = ['active', 'frozen', 'disconnected', 'suspended'] as const;
export const TASK_STATUSES = ['pending', 'working', 'done', 'cancelled'] as const;

function oneOf<T extends string>(list: readonly T[], value: string | undefined): T | undefined {
  return list.find((item) => item === value);
}

/** «ينتهي قريباً»: an active line whose subscription ends within this many days (owner, 2026-11-08). */
export const EXPIRING_DAYS = 3;

/** The window of an expiring line: active, ending between now and EXPIRING_DAYS from now. */
export function expiringWhere(now: Date = new Date()): Prisma.LineWhereInput {
  return { status: 'active', endsAt: { gte: now, lte: new Date(now.getTime() + EXPIRING_DAYS * 86_400_000) } };
}

/** A package's period when none is stored: 90 days after the end (owner 2026-11-09). */
export const SUSPEND_AFTER_DAYS = 90;

/** Whether a line is suspended: active or marked suspended, its subscription over for at least the package's period. */
export function isSuspended(line: { status: string; endsAt: Date }, suspendAfterDays: number = SUSPEND_AFTER_DAYS, now: Date = new Date()): boolean {
  if (line.status !== 'active' && line.status !== 'suspended') return false;
  return line.endsAt.getTime() <= now.getTime() - suspendAfterDays * 86_400_000;
}

/**
 * The suspended lines (spec 2026-11-08-overview-and-reports-nav, I), one condition per package period in use: the
 * database cannot add a package's days to the end date, so each period gets its own cut-off.
 */
export function suspendedWhere(periods: number[], now: Date = new Date()): Prisma.LineWhereInput {
  const days = [...new Set(periods.length ? periods : [SUSPEND_AFTER_DAYS])];
  return {
    status: { in: ['active', 'suspended'] },
    OR: days.map((period) => ({ package: { suspendAfterDays: period }, endsAt: { lte: new Date(now.getTime() - period * 86_400_000) } })),
  };
}

export type LineFilter = { q?: string; status?: string; packageCode?: string; provider?: string; company?: string };

/**
 * The where clause of the numbers list. `q` searches the number and the serial (spaces removed,
 * so "055 024" finds 055024 and "899 720" finds that serial), plus the package name and the
 * company name. Provider, company, and package narrow the same row together.
 */
export function linesWhere(posIds: string[], filter: LineFilter, suspendPeriods: number[] = []): Prisma.LineWhereInput {
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
    // `expiring` and `suspended` are not stored statuses: they narrow the lines by their end date.
    ...(filter.status === 'expiring' ? expiringWhere() : filter.status === 'suspended' ? suspendedWhere(suspendPeriods) : status ? { status } : {}),
    ...(Object.keys(pack).length ? { package: pack } : {}),
    ...search,
  };
}

export function taskStatusOf(value: string | undefined): (typeof TASK_STATUSES)[number] | undefined {
  return oneOf(TASK_STATUSES, value);
}
