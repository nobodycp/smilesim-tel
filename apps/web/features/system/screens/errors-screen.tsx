'use client';

import { ScrollText, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { DataTable, type Column } from '../../../components/data-table';
import { DateField } from '../../../components/date-field';
import { Desk, Pane, latinWhen } from '../../../components/desk';
import { Dialog } from '../../../components/dialog';
import { Fact, Facts } from '../../../components/facts';
import { FilterBar } from '../../../components/filter-bar';
import { RowMenu } from '../../../components/row-menu';
import { Button } from '../../../components/ui/button';
import { api, type ErrorGroup } from '../../../lib/api';
import { cn } from '../../../lib/cn';
import { usePrefs } from '../../../lib/prefs';
import { useAction } from '../../../lib/use-action';
import { useApiQuery } from '../../../lib/use-api-query';
import { useDebouncedField, useUrlFilters } from '../../../lib/url-state';
import { CopyValue } from '../../lines/line-details';
import { ReportFilters } from '../../reports/report-kit';
import type { ErrorFilters } from '../api';
import { CELL_SUB, routeText } from '../kit';
import { useSystemOwner } from '../use-system-owner';

// The filters in the address (`?route=/v1/lines/:id&from=2026-11-17`), as the request log keeps its own.
const FILTER_KEYS = ['route', 'from', 'to'] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/*
 * The stack frames: a left-to-right block in the system monospace (`font-mono`, DESIGN.md → Type), 12px on
 * `--rd-surface-2` with 6px corners and 10px / 12px padding, one frame a line, scrolling sideways on its own when a
 * frame is longer than the dialog (the page never widens).
 */
const STACK = 'm-0 max-h-72 overflow-auto rounded-sm bg-surface-2 px-3 py-2.5 text-start font-mono text-sm leading-1-5 whitespace-pre text-ink-2';

/*
 * A table's `bdi` stays on one line (the table's own rule); on a phone's card a long route or class name breaks instead
 * (after a slash first, `routeText`), so the card never runs past its column.
 */
const PHONE_WRAP = 'wrap-anywhere max-sm:whitespace-normal';

function groupKey(row: ErrorGroup) {
  return `${row.method} ${row.route} ${row.name} ${row.message}`;
}

/** The request log's rows of one group's route: the failed answers (5xx) of that pattern. */
function requestsHref(row: ErrorGroup) {
  return `/system/requests?${new URLSearchParams({ status: '5xx', route: row.route }).toString()}`;
}

/** The server errors (spec 2026-11-17-system-monitor, section 3): the branch owner's page. */
export function ErrorsScreen() {
  return useSystemOwner() ? <ErrorsDesk /> : null;
}

function ErrorsDesk() {
  const { t } = usePrefs();
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [open, setOpen] = useState<ErrorGroup | null>(null);
  const [clearing, setClearing] = useState(false);

  const [filters, setFilters] = useUrlFilters(FILTER_KEYS);
  const from = DAY.test(filters.from) ? filters.from : '';
  const to = DAY.test(filters.to) ? filters.to : '';
  const [route, setRoute] = useDebouncedField(filters.route, useCallback((value: string) => setFilters({ route: value }), [setFilters]));

  const query: ErrorFilters = { route: filters.route, from, to };
  const groups = useApiQuery(['api', 'system', 'errors', filters.route, from, to], () => api.errorGroups(query));
  const { run, busy } = useAction({ setError, setNote, onDone: () => groups.reload() });

  function clearErrors() {
    void run(() => api.clearErrors(), {
      note: (answer) => t.errCleared.replace('{n}', answer.removed.toLocaleString('en')),
      then: () => setClearing(false),
    });
  }

  const columns: Column<ErrorGroup>[] = [
    { key: 'last', header: t.errLastAt, kind: 'when', sortValue: (row) => row.lastAt, render: (row) => <bdi dir="ltr">{latinWhen(row.lastAt, true)}</bdi> },
    {
      key: 'route',
      header: t.reqLogRoute,
      sortValue: (row) => `${row.route} ${row.method}`,
      render: (row) => <bdi dir="ltr" className={PHONE_WRAP}><span className="font-semibold">{row.method}</span> {routeText(row.route)}</bdi>,
    },
    {
      key: 'class',
      header: t.errClass,
      sortValue: (row) => row.name,
      render: (row) => (
        <span>
          <bdi dir="ltr" className={cn('font-semibold', PHONE_WRAP)}>{row.name}</bdi>
          <bdi dir="ltr" className={CELL_SUB}>{row.message}</bdi>
        </span>
      ),
    },
    { key: 'count', header: t.reqLogCalls, num: true, sortValue: (row) => row.count, render: (row) => row.count.toLocaleString('en') },
    { key: 'first', header: t.errFirstAt, kind: 'when', sortValue: (row) => row.firstAt, render: (row) => <bdi dir="ltr">{latinWhen(row.firstAt, true)}</bdi> },
    {
      key: 'ops',
      header: t.rowActions,
      actions: true,
      render: (row) => <RowMenu label={`${t.rowActions} ${row.name} ${row.route}`} items={[{ label: t.errDetails, icon: 'receipt', onClick: () => setOpen(row) }]} />,
    },
  ];

  const data = groups.data;

  return (
    <Desk
      title={t.navErrors}
      lede={t.errLede}
      error={error || groups.error}
      note={note}
      action={(
        <Button type="button" variant="danger" onClick={() => { setError(''); setClearing(true); }}>
          <Trash2 size={15} aria-hidden="true" />
          {t.errClear}
        </Button>
      )}
    >
      <ReportFilters>
        <FilterBar loose onClear={() => setFilters({ route: '', from: '', to: '' })} clearLabel={t.clearFilters}>
          <label>
            {t.reqLogRoute}
            <input dir="ltr" aria-label={t.reqLogRoute} value={route} maxLength={200} onChange={(event) => setRoute(event.target.value)} />
          </label>
          <label>
            {t.from}
            <DateField value={from} onChange={(next) => setFilters({ from: next })} />
          </label>
          <label>
            {t.to}
            <DateField value={to} onChange={(next) => setFilters({ to: next })} />
          </label>
        </FilterBar>
      </ReportFilters>
      {data?.capped ? (
        <p className="m-0 text-md text-muted" role="status" data-testid="errors-capped">
          {t.errCapped.replace('{total}', data.total.toLocaleString('en'))}
        </p>
      ) : null}
      <Pane data-testid="errors-pane">
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={groupKey}
          loading={!groups.loaded}
          failed={groups.error}
          onRetry={() => void groups.reload()}
          empty={t.errEmpty}
          keepHead
          skeleton={{ rows: 6, columns: 6 }}
        />
      </Pane>
      <Dialog open={open !== null} title={t.errDetails} closeLabel={t.closeMenu} onClose={() => setOpen(null)}>
        {open ? (
          <div className="grid gap-3">
            <Facts variant="list">
              <Fact label={t.reqLogRoute}><bdi dir="ltr"><span className="font-semibold">{open.method}</span> {routeText(open.route)}</bdi></Fact>
              <Fact label={t.errClass}><bdi dir="ltr">{open.name}</bdi></Fact>
              <Fact label={t.errMessage}><bdi dir="ltr">{open.message}</bdi></Fact>
              <Fact label={t.reqLogCalls}><bdi dir="ltr">{open.count.toLocaleString('en')}</bdi></Fact>
              <Fact label={t.errFirstAt}><bdi dir="ltr">{latinWhen(open.firstAt, true)}</bdi></Fact>
              <Fact label={t.errLastAt}><bdi dir="ltr">{latinWhen(open.lastAt, true)}</bdi></Fact>
              <Fact label={t.errLastRequest}><CopyValue value={open.lastRequestId} /></Fact>
            </Facts>
            <section className="grid gap-1.5" aria-label={t.errStack}>
              <h3 className="m-0 text-xs font-bold text-muted">{t.errStack}</h3>
              {open.stack.length > 0 ? (
                <pre dir="ltr" className={STACK} data-testid="error-stack">{open.stack.join('\n')}</pre>
              ) : (
                <p className="m-0 text-md text-muted">{t.errNoStack}</p>
              )}
            </section>
            <Button asChild variant="secondary" size="sm" className="justify-self-start">
              <Link href={requestsHref(open)} onClick={() => setOpen(null)}>
                <ScrollText size={15} aria-hidden="true" />
                {t.errShowRequests}
              </Link>
            </Button>
          </div>
        ) : null}
      </Dialog>
      <Dialog
        open={clearing}
        size="confirm"
        title={t.errClear}
        lede={t.errClearHint}
        mark="trash"
        tone="danger"
        closeLabel={t.closeMenu}
        error={error}
        onClose={() => { if (!busy) setClearing(false); }}
        footer={(
          <>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setClearing(false)}>{t.cancel}</Button>
            <Button type="button" variant="danger" disabled={busy} onClick={clearErrors}>{t.errClear}</Button>
          </>
        )}
      >
        <p className="m-0 text-md text-muted">{t.errClearAll}</p>
      </Dialog>
    </Desk>
  );
}
