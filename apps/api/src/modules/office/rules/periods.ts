import { DISCONNECT_FEE, type LineTerms, type PackageTerms, captureTerms } from './prices';

// Paid periods of a line: when one ends, what is still open, what a disconnect gives back, and how a renewal or
// a switch moves them. Pure: no Nest, no Prisma.

/** A charged or extended package month is 30 days, not a calendar month. */
export const PERIOD_DAYS = 30;

export function periodEnd(from: Date, months: number): Date {
  const next = new Date(from.getTime());
  next.setUTCDate(next.getUTCDate() + PERIOD_DAYS * Math.max(1, months));
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

/** A paid period still open on a line: its length, the whole days left, and what those days are worth. */
export type OpenPeriod = { days: number; left: number; value: number; renewal: boolean };

/** A wallet row that bought time (or, for a switch, repriced it), as stored. */
export type PrepaidRow = {
  kind: string;
  packagePrice: number | null;
  periodDays: number | null;
  periodEndsAt: Date | null;
};

const RUN_START_KINDS = new Set(['activate', 'charge', 'reactivate']);
const RENEWAL_PERIOD_KINDS = new Set(['charge', 'extend', 'reactivate']);

/**
 * Paid periods still open, read from the prepaid rows newest first back to the row that started the
 * current run. The newest switch reprices every older period. Null when a row in the run has no period.
 */
export function openPeriods(now: Date, rows: PrepaidRow[]): OpenPeriod[] | null {
  const open: OpenPeriod[] = [];
  let repriced: { price: number; days: number } | null = null;
  for (const row of rows) {
    if (!row.periodDays || row.packagePrice === null) return null;
    if (row.kind === 'switch') {
      repriced ??= { price: row.packagePrice, days: row.periodDays };
      continue;
    }
    if (!row.periodEndsAt) return null;
    if (now.getTime() < row.periodEndsAt.getTime()) {
      const left = daysLeft(now, row.periodEndsAt, row.periodDays);
      const rate = repriced ?? { price: row.packagePrice, days: row.periodDays };
      open.push({ days: row.periodDays, left, value: Math.round((rate.price * left) / rate.days), renewal: RENEWAL_PERIOD_KINDS.has(row.kind) });
    }
    if (RUN_START_KINDS.has(row.kind)) break;
  }
  return open;
}

/** The last window alone, for lines whose rows carry no periods. */
export function lastWindow(now: Date, endsAt: Date, months: number, price: number, renewal: boolean): OpenPeriod[] {
  const days = PERIOD_DAYS * Math.max(1, months);
  if (now.getTime() >= endsAt.getTime()) return [];
  const left = daysLeft(now, endsAt, days);
  return [{ days, left, value: Math.round((price * left) / days), renewal }];
}

/**
 * One disconnect posting for a line with paid days left.
 * The point of sale is credited every unused paid day minus the half-shekel fee.
 * The provider cost is the used share of the running period's branch cost plus that same fee.
 * A line with no open period is not a disconnect: the subscription lapsed.
 */
export function settleDisconnect(
  periods: OpenPeriod[],
  branchCostOf: (renewal: boolean) => number,
): { amount: number; providerCost: number } | null {
  const running = periods[periods.length - 1];
  if (!running) return null;
  const refund = periods.reduce((sum, period) => sum + period.value, 0);
  const used = Math.round((branchCostOf(running.renewal) * (running.days - running.left)) / running.days);
  return { amount: refund - DISCONNECT_FEE, providerCost: used + DISCONNECT_FEE };
}

export function renewStay(
  line: LineTerms,
  from: Date,
): { endsAt: Date; debit: number; terms: LineTerms } {
  return {
    endsAt: periodEnd(from, line.months),
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
    endsAt: periodEnd(from, saved.months),
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
  newMonths: number,
): { currentValue: number; newValue: number; difference: number } {
  const days = periods.reduce((sum, period) => sum + period.left, 0);
  const currentValue = periods.reduce((sum, period) => sum + period.value, 0);
  const newValue = Math.round((newPrice * days) / (PERIOD_DAYS * Math.max(1, newMonths)));
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
