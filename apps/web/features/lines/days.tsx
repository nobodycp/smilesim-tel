import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/cn';

export type DaysTone = 'left' | 'soon' | 'out' | 'off';

/*
 * What is left on a number (ADR 0022): one inline row 5px
 * apart, 12.5px `--rd-ink-2`; `soon` (it ends within EXPIRING_DAYS) bold `--rd-accent`, `out` (ended) `--rd-danger`,
 * `off` (not active) `--rd-muted`. Beside the number on its card it is 13px: the caller's `className` comes last
 * (`cn`). `data-slot="days"` is its handle.
 */
const DAYS = 'inline-flex items-center gap-1.25 text-chip';

const TONE: Record<DaysTone, string> = {
  left: 'text-ink-2',
  soon: 'font-bold text-accent',
  out: 'text-danger',
  off: 'text-muted',
};

export function Days({ tone, className, ...props }: ComponentPropsWithoutRef<'span'> & { tone: DaysTone }) {
  return <span data-slot="days" className={cn(DAYS, TONE[tone], className)} {...props} />;
}
