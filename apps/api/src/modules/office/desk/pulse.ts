// The home's period cards (owner 2026-11-09): sales (every sale operation and its volume), new subscriptions
// (activations) and profit, each against the same span of the period before, with a trend over the period.
// Pure: the overview loads the rows.

import type { OverviewPeriod } from './overview.service';

export type PulseTotals = { count: number; amount: number; activations: number; profit: number };
export type PulsePoint = PulseTotals & { at: string };

export const emptyTotals = (): PulseTotals => ({ count: 0, amount: 0, activations: 0, profit: 0 });

const DAY = 86_400_000;

function dayStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * The same span of the period before: today so far against yesterday up to this time; this month so far against the
 * month before over as many days and hours (cut at its end). All time has nothing to compare with.
 */
export function previousWindow(period: OverviewPeriod, now: Date): { from: Date; to: Date } | null {
  if (period === 'day') {
    const start = dayStart(now);
    return { from: new Date(start.getTime() - DAY), to: new Date(now.getTime() - DAY) };
  }
  if (period === 'month') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const to = new Date(Math.min(from.getTime() + (now.getTime() - start.getTime()), start.getTime() - 1));
    return { from, to };
  }
  return null;
}

export type Step = 'hour' | 'day' | 'month';

/** The trend's step: the hour today, the day this month; over all time the hour for a history of two days or less,
 *  the day up to two months, the month after that, so a young office still sees a line. */
export function stepOf(period: OverviewPeriod, now: Date, first: Date | null): Step {
  if (period === 'day') return 'hour';
  if (period === 'month') return 'day';
  const age = first ? now.getTime() - first.getTime() : 0;
  if (age <= 2 * DAY) return 'hour';
  return age <= 62 * DAY ? 'day' : 'month';
}

export function bucketOf(step: Step, at: Date): string {
  const iso = at.toISOString();
  if (step === 'hour') return iso.slice(0, 13);
  if (step === 'day') return iso.slice(0, 10);
  return iso.slice(0, 7);
}

/** Every step of the period up to now, so a quiet hour, day or month is drawn as zero. All time: at most 24 months. */
export function axis(period: OverviewPeriod, now: Date, first: Date | null): string[] {
  const step = stepOf(period, now, first);
  const steps: string[] = [];
  if (step === 'hour') {
    const hourOf = (at: Date) => Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), at.getUTCHours());
    const begin = period === 'day' ? dayStart(now).getTime() : hourOf(first ?? now);
    for (let at = begin; at <= now.getTime(); at += 3_600_000) steps.push(bucketOf('hour', new Date(at)));
    return steps;
  }
  if (step === 'day') {
    const begin = period === 'month' ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) : dayStart(first ?? now).getTime();
    for (let at = begin; at <= now.getTime(); at += DAY) steps.push(bucketOf('day', new Date(at)));
    return steps;
  }
  const end = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const begin = Math.max(end - 23, first ? first.getUTCFullYear() * 12 + first.getUTCMonth() : end);
  for (let month = begin; month <= end; month += 1) steps.push(bucketOf('month', new Date(Date.UTC(Math.floor(month / 12), month % 12, 1))));
  return steps;
}

/** Adds one wallet entry: a sale (negative amount) counts and adds its volume; every entry adds its profit. */
export function addEntry(totals: PulseTotals, entry: { kind: string; amount: number }, profit: number) {
  if (entry.amount < 0) {
    totals.count += 1;
    totals.amount += -entry.amount;
    if (entry.kind === 'activate') totals.activations += 1;
  }
  totals.profit += profit;
}
