import type { ReactNode } from 'react';
import { EmptyState } from './empty-state';
import { LoadMore } from './load-more';
import { TableSkeleton } from './loading';

export type Column<Row> = {
  key: string;
  header: ReactNode;
  render: (row: Row) => ReactNode;
  // A number or an amount: `num` on the header and on every cell.
  num?: boolean;
  // The operations column that holds a RowMenu: `row-actions` on the header and on every cell.
  actions?: boolean;
  // A column that stays as narrow as its content: `fit` on the header and on every cell.
  fit?: boolean;
  // An extra class for the cells only, for example `when` or `msisdn`.
  cell?: string;
};

function classes(...names: (string | false | undefined)[]): string | undefined {
  const list = names.filter(Boolean).join(' ');
  return list || undefined;
}

/**
 * A thin wrapper over `.sheet` and `.data`. It writes the table markup content-ui.mdc defines and nothing else.
 *
 * `loading` shows the skeleton. When `rows` is empty and `empty` is given, the empty message replaces
 * the table, unless `keepHead` is set: then the header stays and the message sits under it, inside the sheet.
 * `bare` writes only the `<table>`, for a table that lives inside another block (a company, a tab).
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  loading = false,
  empty,
  keepHead = false,
  bare = false,
  skeleton,
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  loading?: boolean;
  empty?: ReactNode;
  keepHead?: boolean;
  bare?: boolean;
  skeleton?: { rows?: number; columns?: number };
}) {
  if (loading) {
    return (
      <div className="sheet">
        <TableSkeleton rows={skeleton?.rows ?? 5} columns={skeleton?.columns ?? columns.length} />
      </div>
    );
  }
  const hollow = rows.length === 0 && empty !== undefined;
  if (hollow && !keepHead) return <EmptyState>{empty}</EmptyState>;

  const table = (
    <table className="data">
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key} className={classes(column.fit && 'fit', column.num && 'num', column.actions && 'row-actions')}>
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)}>
            {columns.map((column) => (
              <td key={column.key} className={classes(column.fit && 'fit', column.num && 'num', column.actions && 'row-actions', column.cell)}>
                {column.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
  if (bare) return table;
  return (
    <div className="sheet">
      {table}
      {hollow ? <EmptyState>{empty}</EmptyState> : null}
    </div>
  );
}

// What a cursor-paged list (`usePaged`) hands to the table.
export type PagedView<Row> = {
  rows: Row[];
  ready: boolean;
  next: string | null;
  more: boolean;
  loadMore: () => void;
};

/**
 * A `DataTable` over a `usePaged` list, with the "load more" row under it while the server has another page.
 * It writes no `.pane`: the page owns the pane, since a dialog or a head may live in it.
 * `waiting` keeps the skeleton up for something else the table needs (the package catalog of numbers).
 */
export function PagedTable<Row>({
  list,
  waiting = false,
  ...table
}: {
  list: PagedView<Row>;
  waiting?: boolean;
  columns: Column<Row>[];
  rowKey: (row: Row) => string;
  empty?: ReactNode;
  keepHead?: boolean;
  skeleton?: { rows?: number; columns?: number };
}) {
  return (
    <>
      <DataTable {...table} rows={list.rows} loading={waiting || !list.ready} />
      {list.next && <LoadMore shown={list.rows.length} loading={list.more} onMore={list.loadMore} />}
    </>
  );
}
