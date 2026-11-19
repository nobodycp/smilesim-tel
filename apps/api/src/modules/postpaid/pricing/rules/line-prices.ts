// Renewal ladder prices stamped onto frozen line terms, grouped for bulk edits, and repriced in place.
//
// Plain data only: no database reads or writes. Callers load `LineTerms` and apply these helpers.

import type { LineTerms } from './prices';

export const RENEWABLE_STATUSES = ['active', 'frozen'] as const;

export function stampRenewal(terms: LineTerms, priceOf: (packageCode: string) => number | null): LineTerms {
  return {
    ...terms,
    subscription: { ...terms.subscription },
    renewal: { ...terms.renewal, posPrice: priceOf(terms.packageCode) ?? terms.renewal.posPrice },
    renewalTargets: terms.renewalTargets.map((target) => ({
      ...target,
      renewal: { ...target.renewal, posPrice: priceOf(target.code) ?? target.renewal.posPrice },
    })),
  };
}

export type PriceGroup = { price: number; count: number };

export function groupLinePrices(lines: { terms: LineTerms }[]): PriceGroup[] {
  const tallies = new Map<number, number>();
  for (const { terms } of lines) {
    const price = terms.renewal.posPrice;
    tallies.set(price, (tallies.get(price) ?? 0) + 1);
  }
  return [...tallies.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([price, count]) => ({ price, count }));
}

export type RepricePlan = { to: number } | { to: 'current'; fresh: LineTerms };

export function repriceLine(line: LineTerms, plan: RepricePlan): LineTerms {
  if (plan.to === 'current') {
    return {
      ...plan.fresh,
      packageCode: line.packageCode,
      months: line.months,
      windowMonths: line.windowMonths,
      subscription: line.subscription,
    };
  }
  return { ...line, renewal: { ...line.renewal, posPrice: plan.to } };
}

export function groupChanges(groups: unknown): { from: number; to: number | 'current' }[] | null {
  if (!Array.isArray(groups)) return null;
  const rows: { from: number; to: number | 'current' }[] = [];
  for (const row of groups) {
    if (row === null || typeof row !== 'object') return null;
    const rec = row as { from?: unknown; to?: unknown };
    const from = rec.from;
    const to = rec.to;
    if (typeof from !== 'number' || !Number.isInteger(from) || from < 0) return null;
    if (to === 'current') {
      rows.push({ from, to: 'current' });
      continue;
    }
    if (typeof to !== 'number' || !Number.isInteger(to) || to < 0) return null;
    if (to === from) continue;
    rows.push({ from, to });
  }
  return rows;
}
