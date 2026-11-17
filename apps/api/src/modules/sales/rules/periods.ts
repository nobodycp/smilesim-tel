import { DISCONNECT_FEE, type LineTerms, type PackageTerms, captureTerms } from '../../pricing';

// Paid periods of a line: when one ends, what is still open, what a disconnect gives back, and how a renewal or
// a switch moves them. Pure: no Nest, no Prisma.

/** A charged or extended package month is 30 days, not a calendar month. */
export const PERIOD_DAYS = 30;

/** The days a period of this many months holds. */
export function daysOf(months: number): number {
  return PERIOD_DAYS * Math.max(1, months);
}

export function periodEnd(from: Date, days: number): Date {
  const next = new Date(from.getTime());
  next.setUTCDate(next.getUTCDate() + Math.max(1, days));
  return next;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days left in a paid period. One not started keeps every day, a started day counts as used, a closed one has none. */
function daysLeft(now: Date, endsAt: Date, periodDays: number): number {
  const end = endsAt.getTime();
  const at = now.getTime();
  if (at >= end) return 0;
  const start = end - periodDays * DAY_MS;
  if (at < start) return periodDays;
  const usedDays = Math.min(periodDays, Math.max(1, Math.ceil((at - start) / DAY_MS)));
  return periodDays - usedDays;
}

export function windowMonthsOf(line: { months: number; windowMonths?: number }): number {
  return line.windowMonths ?? line.months;
}

/**
 * A paid period still open on a line: its length, the whole days left, what those days are worth, and what the
 * branch paid the provider for the whole period (null on rows written before the cost was kept).
 */
export type OpenPeriod = { days: number; left: number; value: number; renewal: boolean; cost: number | null };

/** A wallet row that bought time (or, for a switch, repriced it), as stored. */
export type PrepaidRow = {
  kind: string;
  packagePrice: number | null;
  periodDays: number | null;
  periodEndsAt: Date | null;
  periodCost?: number | null;
};

const RUN_START_KINDS = new Set(['activate', 'charge', 'reactivate']);
const RENEWAL_PERIOD_KINDS = new Set(['charge', 'extend', 'reactivate']);

/**
 * Paid periods still open, read from the prepaid rows newest first back to the row that started the
 * current run. The newest switch reprices every older period, its price and its cost. Null when a row in the run
 * has no period.
 */
export function openPeriods(now: Date, rows: PrepaidRow[]): OpenPeriod[] | null {
  const open: OpenPeriod[] = [];
  let repriced: { price: number; days: number; cost: number | null } | null = null;
  for (const row of rows) {
    if (!row.periodDays || row.packagePrice === null) return null;
    if (row.kind === 'switch') {
      repriced ??= { price: row.packagePrice, days: row.periodDays, cost: row.periodCost ?? null };
      continue;
    }
    if (!row.periodEndsAt) return null;
    if (now.getTime() < row.periodEndsAt.getTime()) {
      const left = daysLeft(now, row.periodEndsAt, row.periodDays);
      const rate = repriced ?? { price: row.packagePrice, days: row.periodDays, cost: row.periodCost ?? null };
      const cost = rate.cost === null ? null : Math.round((rate.cost * row.periodDays) / rate.days);
      open.push({ days: row.periodDays, left, value: Math.round((rate.price * left) / rate.days), renewal: RENEWAL_PERIOD_KINDS.has(row.kind), cost });
    }
    if (RUN_START_KINDS.has(row.kind)) break;
  }
  return open;
}

/** The last window alone, for lines whose rows carry no periods. */
export function lastWindow(now: Date, endsAt: Date, days: number, price: number, renewal: boolean): OpenPeriod[] {
  if (now.getTime() >= endsAt.getTime()) return [];
  const left = daysLeft(now, endsAt, days);
  return [{ days, left, value: Math.round((price * left) / days), renewal, cost: null }];
}

/**
 * The paid periods open at `now`, as a disconnect and a switch read them: from the prepaid rows (newest first),
 * else, when a row in the run carries no period, the line's last window (`endsAt`, `windowDays` long) at the newest
 * row's price, or `priceOf` the line's terms when there is no row. `lastPrice` is that price.
 */
export function periodsAt(
  now: Date,
  rows: PrepaidRow[],
  endsAt: Date,
  windowDays: number,
  priceOf: (renewal: boolean) => number,
): { periods: OpenPeriod[]; lastPrice: number } {
  const last = rows[0];
  const renewal = Boolean(last && RENEWAL_PERIOD_KINDS.has(last.kind));
  const lastPrice = last?.packagePrice ?? priceOf(renewal);
  return { periods: openPeriods(now, rows) ?? lastWindow(now, endsAt, windowDays, lastPrice, renewal), lastPrice };
}

/** What the branch paid the provider for the open periods: each one's kept cost, else the line's terms (older rows). */
export function periodsCost(periods: OpenPeriod[], branchCostOf: (renewal: boolean) => number): number {
  return periods.reduce((sum, period) => sum + (period.cost ?? branchCostOf(period.renewal)), 0);
}

/**
 * One disconnect posting for a line with paid days left.
 * The point of sale is credited every unused paid day minus the half-shekel fee.
 * The provider gives back the cost of the unused days less that same fee (owner, ADR 0025 answer 3; spec section
 * "A disconnect lowers the purchases (DB.5 P.6)"): the open periods' cost (`periodsCost`) minus the used share of
 * the running period minus the fee. The entry's provider cost is minus that, `used + fee − cost`: negative while
 * unused days are worth more than the fee, +fee on the last day. Not clamped: one rule, the used share's one rounding.
 * A line with no open period is not a disconnect: the subscription lapsed.
 * `refundable` is false when the unused days are worth no more than the fee: such a disconnect is refused, and
 * one already carried out at the provider moves no money (owner, 2026-11-15).
 */
export function settleDisconnect(
  periods: OpenPeriod[],
  branchCostOf: (renewal: boolean) => number,
): { amount: number; providerCost: number; refundable: boolean } | null {
  const running = periods[periods.length - 1];
  if (!running) return null;
  const refund = periods.reduce((sum, period) => sum + period.value, 0);
  const used = Math.round(((running.cost ?? branchCostOf(running.renewal)) * (running.days - running.left)) / running.days);
  const refundable = refund > DISCONNECT_FEE;
  return { amount: refundable ? refund - DISCONNECT_FEE : 0, providerCost: used + DISCONNECT_FEE - periodsCost(periods, branchCostOf), refundable };
}

export function renewStay(
  line: LineTerms,
  from: Date,
): { endsAt: Date; debit: number; terms: LineTerms } {
  return {
    endsAt: periodEnd(from, daysOf(line.months)),
    debit: line.renewal.posPrice,
    terms: { ...line, windowMonths: line.months },
  };
}

export function renewOnto(
  line: LineTerms,
  target: PackageTerms,
  from: Date,
):
  | { endsAt: Date; debit: number; terms: LineTerms }
  | { error: 'NOT_A_RENEWAL_TARGET' } {
  const saved = line.renewalTargets.find((item) => item.code === target.code);
  if (!saved) return { error: 'NOT_A_RENEWAL_TARGET' as const };
  const renewal = { ...saved.renewal };
  return {
    endsAt: periodEnd(from, daysOf(saved.months)),
    debit: renewal.posPrice,
    terms: {
      ...captureTerms({ ...target, months: saved.months, subscription: renewal, renewal }, []),
      windowMonths: saved.months,
    },
  };
}

/** Every day left in the open periods, valued on the new package, against what those days are worth now. */
export function switchOver(
  periods: OpenPeriod[],
  newPrice: number,
  newDays: number,
): { currentValue: number; newValue: number; difference: number } {
  const days = periods.reduce((sum, period) => sum + period.left, 0);
  const currentValue = periods.reduce((sum, period) => sum + period.value, 0);
  const newValue = Math.round((newPrice * days) / Math.max(1, newDays));
  return { currentValue, newValue, difference: newValue - currentValue };
}

/** The same open periods at another full-period price, such as the branch cost. */
export function revalue(periods: OpenPeriod[], priceOf: (period: OpenPeriod) => number): OpenPeriod[] {
  return periods.map((period) => ({ ...period, value: Math.round((priceOf(period) * period.left) / period.days) }));
}

export function switchOnto(
  line: LineTerms,
  current: PackageTerms,
  target: PackageTerms,
  allowedCodes: string[],
):
  | { terms: LineTerms }
  | { error: 'SAME_PACKAGE' | 'OTHER_SHELF' | 'NOT_ALLOWED' } {
  if (target.code === line.packageCode) return { error: 'SAME_PACKAGE' as const };
  if (target.companyCode !== current.companyCode || target.providerCode !== current.providerCode) {
    return { error: 'OTHER_SHELF' as const };
  }
  if (!allowedCodes.includes(target.code)) return { error: 'NOT_ALLOWED' as const };
  const renewal = { ...target.renewal };
  return {
    terms: {
      ...captureTerms({ ...target, subscription: renewal, renewal }, []),
      windowMonths: windowMonthsOf(line),
    },
  };
}
