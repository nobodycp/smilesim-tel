'use client';

import { Download, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../../components/ui/button';
import { SegmentedToggle, SegmentedToggleItem } from '../../components/ui/segmented';
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
 * The period switch, on `SegmentedToggle`: a row of `aria-pressed` buttons, the chosen one over the crimson thread
 * (components/ui/segmented.tsx).
 * `data-slot="period"` is its handle.
 */
/** The period switch of the Graphite report pages: today, 7 days, 30 days, 3 months. */
export function Period({ days, onPick }: { days: number; onPick: (days: PeriodDays) => void }) {
  const { t } = usePrefs();
  const label = (value: PeriodDays) => (value === 1 ? t.periodToday : value === 7 ? t.period7 : value === 30 ? t.period30 : t.period3m);
  return (
    <SegmentedToggle data-slot="period" aria-label={t.period}>
      {PERIODS.map((value) => (
        <SegmentedToggleItem key={value} pressed={days === value} onClick={() => onPick(value)}>
          {label(value)}
        </SegmentedToggleItem>
      ))}
    </SegmentedToggle>
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
 * The search chip of a report's filter row, a `FilterBar` child: the label stays a direct `<label>` of the filter
 * panel, so the chip rules of app/tailwind.css (`[data-slot='filter-panel'] > label`) draw what it does not set, and
 * FilterBar's clear still sees its field. Over those rules: 280px wide (never wider than the row), 36px high with a 36px line (44px / 42px in the
 * open «كل الفلاتر» drawer, whose rule won over it), 12px at the sides, 8px between the icon and the field, no border,
 * `--rd-sunken` with a 1px inset `--rd-line` ring that turns crimson while the field has the focus or a value, the text
 * `--rd-muted` either way. The icon keeps its size and sits in the middle. The field takes the rest of the chip
 * (`flex: 1`, no fixed width); its box is the chip field's (`[data-slot='filter-panel'] > label input`).
 * `data-slot="search-chip"` is its handle.
 */
const SEARCH_CHIP = cn(
  'h-9 w-70 max-w-full gap-2 border-0 bg-sunken px-3 leading-9 text-muted inset-ring inset-ring-line',
  "focus-within:inset-ring-accent has-[input:not([value=''])]:inset-ring-accent",
  'max-md:[[data-slot=filter-bar][data-open]_&]:h-11 max-md:[[data-slot=filter-bar][data-open]_&]:leading-10.5',
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
 * The row above a report's figures: the period, then the filter chips: one wrapping row, centred, 10px apart, 14px
 * above what follows; a loose FilterBar in it takes the rest of the row and drops its own margin.
 * `data-slot="report-filters"` is its handle.
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
