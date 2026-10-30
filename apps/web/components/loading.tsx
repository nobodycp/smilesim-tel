'use client';

import { usePrefs } from '../lib/prefs';

export function Spinner({ size = 22 }: { size?: number }) {
  return (
    <svg className="spinner" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity="0.25" />
      <path fill="currentColor" d="M12 2a10 10 0 0 1 10 10h-4a6 6 0 0 0-6-6V2z" />
    </svg>
  );
}

export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="table-skeleton" aria-hidden="true">
      {Array.from({ length: rows }).map((_, row) => (
        <div className="table-skeleton-row" key={row}>
          {Array.from({ length: columns }).map((__, column) => (
            <span className="skeleton" key={column} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  const { t } = usePrefs();
  return (
    <div className="desk loading-well" aria-busy="true" aria-label={t.loading}>
      <div className="page-head">
        <span className="skeleton sk-title" />
        <span className="skeleton sk-lede" />
      </div>
      <div className="stat-row">
        <span className="skeleton sk-stat" />
        <span className="skeleton sk-stat" />
        <span className="skeleton sk-stat" />
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
