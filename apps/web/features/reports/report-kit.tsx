'use client';

import { Download } from 'lucide-react';
import type { ReactNode } from 'react';
import { buttonClass } from '../../components/ui/button';
import { usePrefs } from '../../lib/prefs';

/** The windows a report page offers, in days; 30 is where each opens. */
export const PERIODS = [1, 7, 30, 90] as const;
export type PeriodDays = (typeof PERIODS)[number];

/** The first day of a window of `days` days ending today, as an ISO date. */
export function periodFrom(days: number): string {
  return new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
}

/** The period switch of the Graphite report pages: today, 7 days, 30 days, 3 months. */
export function Period({ days, onPick }: { days: number; onPick: (days: PeriodDays) => void }) {
  const { t } = usePrefs();
  const label = (value: PeriodDays) => (value === 1 ? t.periodToday : value === 7 ? t.period7 : value === 30 ? t.period30 : t.period3m);
  return (
    <div className="period" role="group" aria-label={t.period}>
      {PERIODS.map((value) => (
        <button key={value} type="button" className={days === value ? 'on' : undefined} aria-pressed={days === value} onClick={() => onPick(value)}>
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
    <a className={buttonClass({ variant: 'outline' })} href={href} download aria-label={t.exportCsv}>
      <Download size={15} aria-hidden="true" />
      CSV
    </a>
  );
}

/** The row above a report's figures: the period, then the filter chips. */
export function ReportFilters({ children }: { children: ReactNode }) {
  return <div className="report-filters">{children}</div>;
}
