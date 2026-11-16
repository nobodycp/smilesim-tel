'use client';

import { usePrefs } from '../lib/prefs';
import { Skeleton } from './ui/skeleton';

/*
 * The loading marks (Tailwind migration T2.7, ADR 0022), ported from the legacy desk/components.css and base.css
 * rules: the spinner is a block in ink that turns once every 0.7s when motion is allowed (its size is the global
 * `svg` rule's, base.css); a table skeleton row is a grid of equal cells 12px apart, 13px / 14px padding over a 1px
 * `--rd-line` hairline, each cell a 12px bar; the page skeleton stacks its head, figures and pane 16px apart, the
 * title bar 168 by 22px, the lede bar min(440px, 72%) by 14px 10px under it, a figure 92px high with the card corners.
 */
export function Spinner({ size = 22 }: { size?: number }) {
  return (
    <svg className="block text-ink motion-safe:animate-[spin_0.7s_linear_infinite]" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity="0.25" />
      <path fill="currentColor" d="M12 2a10 10 0 0 1 10 10h-4a6 6 0 0 0-6-6V2z" />
    </svg>
  );
}

export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div data-testid="table-skeleton" aria-hidden="true">
      {Array.from({ length: rows }).map((_, row) => (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(0,1fr))] gap-3 border-b border-line px-3.5 py-3.25" key={row}>
          {Array.from({ length: columns }).map((__, column) => (
            <Skeleton className="h-3" key={column} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  const { t } = usePrefs();
  return (
    <div className="desk grid gap-4" aria-busy="true" aria-label={t.loading}>
      <div className="page-head">
        <Skeleton className="h-5.5 w-42" />
        <Skeleton className="mt-2.5 h-3.5 w-[min(440px,72%)]" />
      </div>
      <div className="stat-row">
        <Skeleton className="h-23 rounded-card" />
        <Skeleton className="h-23 rounded-card" />
        <Skeleton className="h-23 rounded-card" />
      </div>
      <section className="pane">
        <header className="pane-head">
          <Spinner />
        </header>
        <TableSkeleton />
      </section>
    </div>
  );
}
