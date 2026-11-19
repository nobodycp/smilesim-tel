import type { Prisma } from '../../../../generated/prisma/client';
import { searchTerms } from '../../../platform';

// The filters of the numbers list and the line windows the reports count (expiring, suspended). Everything here is
// pure: the service hands the result to Prisma, so filters run in the database and never over loaded rows. Slice
// R.3; the page sizes are the platform's (`platform/paging.ts`), the task statuses
// the tasks' (`tasks/task-status.ts`).

export const LINE_STATUSES = ['active', 'frozen', 'disconnected', 'suspended'] as const;

function oneOf<T extends string>(list: readonly T[], value: string | undefined): T | undefined {
  return list.find((item) => item === value);
}

/** «ينتهي قريباً»: an active line whose subscription ends within this many days (owner, 2026-11-08). */
export const EXPIRING_DAYS = 3;

/** The window of an expiring line: active, ending between now and EXPIRING_DAYS from now. */
export function expiringWhere(now: Date = new Date()): Prisma.PostpaidLineWhereInput {
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
export function suspendedWhere(periods: number[], now: Date = new Date()): Prisma.PostpaidLineWhereInput {
  const days = [...new Set(periods.length ? periods : [SUSPEND_AFTER_DAYS])];
  return {
    status: { in: ['active', 'suspended'] },
    OR: days.map((period) => ({ package: { suspendAfterDays: period }, endsAt: { lte: new Date(now.getTime() - period * 86_400_000) } })),
  };
}

export type LineFilter = { q?: string; status?: string; packageCode?: string; provider?: string; company?: string; sim?: string };

/**
 * The search of the numbers list and the top bar (spec 2026-11-17-scale-speed-cleanup, "Search (DB.6)"): the number
 * and the serial contain what was typed as a number (`searchTerms`: Arabic-Indic digits as ASCII, no spaces or
 * dashes, no leading `+`), or the line is on one of `namedPackageIds`, the packages whose name or company's name
 * contains the text (`LinesRepository.packageIdsNamed`, read from the catalog first). The big table is filtered by
 * trigram indexes and an id list, never joined to the catalog on `ILIKE`.
 */
export function lineSearch(q: string | undefined, namedPackageIds: string[]): Prisma.PostpaidLineWhereInput {
  const terms = searchTerms(q);
  if (!terms) return {};
  return {
    OR: [
      { msisdn: { contains: terms.number } },
      { iccid: { contains: terms.number } },
      ...(namedPackageIds.length ? [{ packageId: { in: namedPackageIds } }] : []),
    ],
  };
}

/**
 * The where clause of the numbers list. `q` searches the number and the serial, plus the package name and the
 * company name (`lineSearch`, with the ids the caller read for those names). Provider, company, and package narrow
 * the same row together. `sim` keeps the SIM (`sim`) or the
 * eSIM (`esim`) lines (spec 2026-11-11-ui-consistency-pass, D1). `posIds` null is every point of sale (the branch's
 * own view): no id list is sent (database plan DB.10), as `taskWhereFor` and `financeWhere` already do.
 */
export function linesWhere(posIds: string[] | null, filter: LineFilter, suspendPeriods: number[] = [], namedPackageIds: string[] = []): Prisma.PostpaidLineWhereInput {
  const status = oneOf(LINE_STATUSES, filter.status);
  const search = lineSearch(filter.q, namedPackageIds);
  const packageCode = (filter.packageCode ?? '').trim();
  const provider = (filter.provider ?? '').trim();
  const company = (filter.company ?? '').trim();
  const pack: Prisma.PostpaidPackageWhereInput = {
    ...(packageCode ? { code: packageCode } : {}),
    ...(provider ? { provider: { name: provider } } : {}),
    ...(company ? { company: { name: company } } : {}),
  };
  return {
    ...(posIds ? { posId: { in: posIds } } : {}),
    // `expiring` and `suspended` are not stored statuses: they narrow the lines by their end date.
    ...(filter.status === 'expiring' ? expiringWhere() : filter.status === 'suspended' ? suspendedWhere(suspendPeriods) : status ? { status } : {}),
    ...(Object.keys(pack).length ? { package: pack } : {}),
    ...(filter.sim === 'esim' ? { esim: true } : filter.sim === 'sim' ? { esim: false } : {}),
    // The search is an OR, and so is the suspended window's one condition per period: the search sits under AND so
    // both hold together (one spread over the other kept only the search). A caller adding its own AND (the page
    // cursor) composes with AND around this whole clause, never by spreading over it.
    ...(search.OR ? { AND: [search] } : {}),
  };
}
