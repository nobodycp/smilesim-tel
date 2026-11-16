'use client';

import { Download, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/cn';
import { usePrefs } from '../../lib/prefs';

/** The windows a report page offers, in days; 30 is where each opens. */
export const PERIODS = [1, 7, 30, 90] as const;
export type PeriodDays = (typeof PERIODS)[number];

/** The first day of a window of `days` days ending today, as an ISO date. */
export function periodFrom(days: number): string {
  return new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
}

/*
 * The period switch (Tailwind migration T4.9), ported from graphite.css `.period`: one row clipped to 4px corners with
 * a 1px inset `--rd-line` edge, never shrinking; the full width under 768px. A period is 34px high, 12px at the sides
 * (6px and an equal share of the row under 768px), no border or fill, 12.5px semibold `--rd-muted` on one line, ink
 * under the pointer; each after the first draws a 1px `--rd-line` on its start edge; the chosen one (`aria-pressed`)
 * sits on `--rd-surface-2` in ink with the 2px crimson thread underneath; the keyboard focus is a 2px crimson outline
 * drawn inside. At 720px and under it keeps the 44px touch height of responsive.css (`.canvas button`).
 * `data-slot="period"` is its handle. features/wallets/wallet-head.tsx still draws the legacy class until T4.7.
 */
const PERIOD = 'inline-flex flex-none overflow-hidden rounded-xs inset-ring inset-ring-line max-md:w-full';
const PERIOD_BUTTON = cn(
  'h-8.5 cursor-pointer whitespace-nowrap border-0 bg-transparent px-3 text-[12.5px] font-semibold text-muted hover:text-ink',
  'not-first:border-s not-first:border-s-line',
  'aria-pressed:bg-surface-2 aria-pressed:text-ink aria-pressed:shadow-[inset_0_-2px_0_var(--rd-accent)]',
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
  'max-md:flex-1 max-md:px-1.5 max-[721px]:min-h-11',
);

/** The period switch of the Graphite report pages: today, 7 days, 30 days, 3 months. */
export function Period({ days, onPick }: { days: number; onPick: (days: PeriodDays) => void }) {
  const { t } = usePrefs();
  const label = (value: PeriodDays) => (value === 1 ? t.periodToday : value === 7 ? t.period7 : value === 30 ? t.period30 : t.period3m);
  return (
    <div data-slot="period" className={PERIOD} role="group" aria-label={t.period}>
      {PERIODS.map((value) => (
        <button key={value} type="button" className={PERIOD_BUTTON} aria-pressed={days === value} onClick={() => onPick(value)}>
          {label(value)}
        </button>
      ))}
    </div>
  );
}

/** The CSV of a report, in the page head. */
export function CsvLink({ href }: { href: string }) {
  const { t } = usePrefs();
  return (
    <Button asChild variant="secondary">
      <a href={href} download aria-label={t.exportCsv}>
        <Download size={15} aria-hidden="true" />
        CSV
      </a>
    </Button>
  );
}

/*
 * The search chip of a report's filter row (Tailwind migration T4.9), a `FilterBar` child: the label stays a direct
 * `<label>` of the filter panel, so the chip rules of graphite.css (`[data-slot='filter-panel'] > label`) still draw
 * what it does not set, and FilterBar's clear still sees its field. Ported from graphite.css `label.filter-search` with
 * the chip rules it won over: 280px wide (never wider than the row), 36px high with a 36px line (44px / 42px in the
 * open «كل الفلاتر» drawer, whose rule won over it), 12px at the sides, 8px between the icon and the field, no border,
 * `--rd-sunken` with a 1px inset `--rd-line` ring that turns crimson while the field has the focus or a value, the text
 * `--rd-muted` either way. The icon keeps its size and sits in the middle. The field takes the rest of the chip
 * (`flex: 1`, no fixed width); its box is the chip field's (graphite.css), which won over the rest of the legacy rule.
 * `data-slot="search-chip"` is its handle. The wallets and audit screens still draw the legacy class until their slices.
 */
const SEARCH_CHIP = cn(
  'h-9 w-70 max-w-full gap-2 border-0 bg-sunken px-3 leading-9 text-muted inset-ring inset-ring-line',
  "focus-within:inset-ring-accent has-[input:not([value=''])]:inset-ring-accent",
  'max-md:[[data-slot=filter-bar][data-open]_&]:h-11 max-md:[[data-slot=filter-bar][data-open]_&]:leading-[42px]',
  '[&>svg]:flex-none [&>svg]:self-center',
);

export function SearchChip({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label data-slot="search-chip" className={SEARCH_CHIP}>
      <Search size={16} strokeWidth={1.9} aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <input className="w-auto flex-1" value={value} placeholder={label} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

/*
 * The row above a report's figures: the period, then the filter chips (Tailwind migration T4.9, ported from graphite.css
 * `.report-filters`): one wrapping row, centred, 10px apart, 14px above what follows; a loose FilterBar in it takes the
 * rest of the row and drops its own margin. `data-slot="report-filters"` is its handle. The notices screen still draws
 * the legacy class until T4.10.
 */
export function ReportFilters({ children }: { children: ReactNode }) {
  return (
    <div
      data-slot="report-filters"
      className="mb-3.5 flex flex-wrap items-center gap-2.5 [&>[data-slot=filter-bar][data-loose]]:m-0 [&>[data-slot=filter-bar][data-loose]]:flex-auto"
    >
      {children}
    </div>
  );
}
