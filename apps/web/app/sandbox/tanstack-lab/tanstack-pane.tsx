'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { lineStatus } from '../../../components/desk';
import { EmptyState } from '../../../components/empty-state';
import { LoadMore } from '../../../components/load-more';
import { TableSkeleton } from '../../../components/loading';
import { api, type LineRow } from '../../../lib/api';
import { usePrefs } from '../../../lib/prefs';

/**
 * Right pane: TanStack Query (cursor pagination via `useInfiniteQuery`) and TanStack Table
 * (headless, rendered through Pearl's own `.sheet` / `.data` markup). The "ends on" column is
 * sortable client-side — the one capability the left pane does not have today, included so the
 * comparison shows a real gap instead of two ways to draw the same fetch.
 */
export function TanstackPane() {
  const { t, locale } = usePrefs();
  const [sorting, setSorting] = useState<SortingState>([]);

  const query = useInfiniteQuery({
    queryKey: ['tanstack-lab-lines'],
    queryFn: async ({ pageParam }) => {
      const result = await api.officeLines({ cursor: pageParam });
      if (!result.ok) throw new Error(result.message);
      return result.data;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const rows = useMemo(() => query.data?.pages.flatMap((page) => page.lines) ?? [], [query.data]);

  const columns = useMemo<ColumnDef<LineRow>[]>(
    () => [
      { accessorKey: 'msisdn', header: t.number, cell: (info) => <bdi dir="ltr">{info.getValue<string>()}</bdi> },
      { accessorKey: 'companyName', header: t.company, cell: (info) => info.getValue<string>() || '—' },
      { accessorKey: 'packageName', header: t.packageName },
      {
        accessorKey: 'status',
        header: t.status,
        cell: (info) => {
          const value = info.getValue<string>();
          return (
            <span className={value === 'active' ? 'badge' : value === 'frozen' ? 'badge pending' : 'badge cancelled'}>
              {lineStatus(t, value)}
            </span>
          );
        },
      },
      {
        accessorKey: 'endsAt',
        header: t.endsOn,
        enableSorting: true,
        cell: (info) => new Date(info.getValue<string>()).toLocaleDateString(),
      },
    ],
    [t],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const errorMessage = query.error instanceof Error ? query.error.message : '';
  const sortHint =
    locale === 'en'
      ? 'Click "ends on" to sort — the left pane cannot do this today.'
      : locale === 'he'
        ? 'לחצו על "מסתיים ב" כדי למיין — הלוח השמאלי לא יכול לעשות זאת כיום.'
        : 'اضغط على "تنتهي في" للفرز — اللوحة اليسرى لا تقدر تعمل هذا حاليًا.';

  return (
    <section className="pane">
      <header className="pane-head">
        <h2>TanStack Query + Table</h2>
      </header>
      <p className="hint">{sortHint}</p>
      {errorMessage && <p className="hint">{errorMessage}</p>}
      {query.isLoading ? (
        <div className="sheet">
          <TableSkeleton rows={5} columns={5} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState>{t.noLines}</EmptyState>
      ) : (
        <div className="sheet">
          <table className="data">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      style={header.column.getCanSort() ? { cursor: 'pointer' } : undefined}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() === 'asc' ? ' ▲' : header.column.getIsSorted() === 'desc' ? ' ▼' : ''}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {query.hasNextPage && (
        <LoadMore shown={rows.length} loading={query.isFetchingNextPage} onMore={() => void query.fetchNextPage()} />
      )}
    </section>
  );
}
