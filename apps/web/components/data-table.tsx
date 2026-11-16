import { isValidElement, useEffect, useState, type ReactNode } from 'react';
import { EmptyState } from './empty-state';
import { LoadFailed } from './load-failed';
import { TableSkeleton } from './loading';
import { Pagination, shouldShowPagination } from './ui/pagination';
import { SortButton, TBody, TCell, THead, THeadCell, TRow, Table, TableSheet, type CellKind } from './ui/table';
import { usePrefs } from '../lib/prefs';

export type Column<Row> = {
  key: string;
  header: ReactNode;
  render: (row: Row) => ReactNode;
  // A number or an amount: tabular figures (`data-num` on the header and on every cell).
  num?: boolean;
  // The operations column that holds a RowMenu (`data-actions` on the header and on every cell).
  actions?: boolean;
  // A column that stays as narrow as its content (`data-fit` on the header and on every cell).
  fit?: boolean;
  // What the cells hold, for their look (components/ui/table.tsx): a line number (`msisdn`), a time (`when`), a long
  // text that wraps (`wrap`), or a block that draws its own card (`block`). `data-kind` on every cell.
  kind?: CellKind;
  // Extra utilities for the cells only.
  cell?: string;
  // A plain value used when the header is clicked. The rendered cell is used when this is absent.
  sortValue?: (row: Row) => string | number | null | undefined;
};

type SortDir = 'asc' | 'desc';

function nodeText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join(' ');
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode; value?: unknown };
    if (typeof props.value === 'number' || typeof props.value === 'string') return String(props.value);
    return nodeText(props.children);
  }
  return '';
}

function blank(value: string): boolean {
  const text = value.trim();
  return text === '' || text === '—' || text === '-' || text === '–';
}

function compareValues(left: string, right: string, numeric: boolean, locale: string): number {
  if (blank(left) && blank(right)) return 0;
  if (blank(left)) return 1;
  if (blank(right)) return -1;
  if (numeric) {
    const ln = Number(left.replace(/,/g, ''));
    const rn = Number(right.replace(/,/g, ''));
    if (!Number.isNaN(ln) && !Number.isNaN(rn)) return ln - rn;
  }
  return left.localeCompare(right, locale, { numeric: true, sensitivity: 'base' });
}

/** The pager row under a table: a hairline above it, 4px / 12px / 8px padding. */
const PAGER = 'border-t border-line px-3 pt-1 pb-2';

/**
 * A thin wrapper over `TableSheet` and `Table` (components/ui/table.tsx). It writes the table markup content-ui.mdc
 * defines and nothing else.
 *
 * `loading` shows the skeleton. When `rows` is empty and `empty` is given, the empty message replaces
 * the table, unless `keepHead` is set: then the header stays and the message sits under it, inside the sheet.
 * `bare` writes only the `<table>`, for a table that lives inside another block (a company, a tab).
 * A full list pages itself from the saved page size. A cursor list (`PagedTable`) passes `paginate={false}`.
 * A header sorts the rows it is given when clicked; `sortable={false}` keeps the headers plain, for a table that holds
 * only one page of a list the server orders (sorting those rows would say nothing about the rest).
 * A phone draws the rows as cards (`cards`, on by default); the lists already drawn as cards (tasks, notices) and the
 * roles matrix pass `cards={false}`. `striped={false}` drops the zebra (the notices). `cellClassName` and
 * `headClassName` add utilities to every body cell and every header cell (a list's own row height, a static head).
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  loading = false,
  empty,
  keepHead = false,
  bare = false,
  paginate,
  sortable = true,
  skeleton,
  failed,
  onRetry,
  onSortStart,
  cards = true,
  striped = true,
  cellClassName,
  headClassName,
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  loading?: boolean;
  empty?: ReactNode;
  keepHead?: boolean;
  bare?: boolean;
  paginate?: boolean;
  sortable?: boolean;
  skeleton?: { rows?: number; columns?: number };
  /** The translated failure of the load. With no rows it replaces the skeleton and the empty sentence. */
  failed?: string;
  onRetry?: () => void;
  /** Told when a header is first clicked: a cursor list (`PagedTable`) then reads every page so the sort is whole. */
  onSortStart?: () => void;
  cards?: boolean;
  striped?: boolean;
  cellClassName?: string;
  headClassName?: string;
}) {
  const { pageSize, setPageSize, locale } = usePrefs();
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(null);
  const paging = paginate ?? !bare;
  const stamp = paging ? `${pageSize}\n${rows.map(rowKey).join('\n')}` : '';
  const [seen, setSeen] = useState(stamp);
  const [page, setPage] = useState(1);
  if (stamp !== seen) {
    setSeen(stamp);
    setPage(1);
  }

  if (failed && rows.length === 0) return <LoadFailed message={failed} onRetry={onRetry} busy={loading} />;
  if (loading) {
    return (
      <TableSheet data-testid="table-sheet">
        <TableSkeleton rows={skeleton?.rows ?? 5} columns={skeleton?.columns ?? columns.length} />
      </TableSheet>
    );
  }
  const hollow = rows.length === 0 && empty !== undefined;
  if (hollow && !keepHead) return <EmptyState>{empty}</EmptyState>;

  const column = sort ? columns.find((item) => item.key === sort.key && !item.actions) : undefined;
  const ordered = column
    ? [...rows].sort((left, right) => {
      const leftText = column.sortValue ? String(column.sortValue(left) ?? '') : nodeText(column.render(left));
      const rightText = column.sortValue ? String(column.sortValue(right) ?? '') : nodeText(column.render(right));
      const result = compareValues(leftText, rightText, Boolean(column.num), locale);
      if (blank(leftText) || blank(rightText)) return result;
      return sort?.dir === 'desc' ? -result : result;
    })
    : rows;
  const size = paging && pageSize !== 'all' ? pageSize : Math.max(ordered.length, 1);
  const pageCount = Math.max(1, Math.ceil(ordered.length / size));
  const current = Math.min(stamp !== seen ? 1 : page, pageCount);
  const visible = paging ? ordered.slice((current - 1) * size, current * size) : ordered;
  // `data-label` names the value when a phone draws the row as a card (spec 2026-11-11-ui-consistency-pass, D7); the
  // cards apply only while at least one row holds a named value (the legacy `:has(td[data-label])`).
  const labelOf = (item: Column<Row>) => (item.actions ? undefined : nodeText(item.header) || undefined);
  const carded = cards && visible.length > 0 && columns.some((item) => labelOf(item) !== undefined);
  const table = (
    <Table cards={carded} striped={striped} data-testid="data-table">
      <THead>
        <TRow>
          {columns.map((item) => {
            const active = sort?.key === item.key;
            const dir = active ? sort.dir : null;
            return (
              <THeadCell
                key={item.key}
                num={item.num}
                actions={item.actions}
                fit={item.fit}
                className={headClassName}
                aria-sort={item.actions || !sortable || !nodeText(item.header).trim() ? undefined : dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
              >
                {/* The actions column names itself to readers only, on every table; a column with no words in its
                    head (a picture, a tick box) does not sort (owner 2026-11-11). */}
                {item.actions ? <span className="sr-only">{nodeText(item.header) || item.header}</span> : !sortable || !nodeText(item.header).trim() ? item.header : (
                  <SortButton
                    order={dir}
                    onClick={() => {
                      onSortStart?.();
                      setSort((current) => (
                        current?.key === item.key
                          ? { key: item.key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
                          : { key: item.key, dir: 'asc' }
                      ));
                      setPage(1);
                    }}
                  >
                    {item.header}
                  </SortButton>
                )}
              </THeadCell>
            );
          })}
        </TRow>
      </THead>
      <TBody>
        {visible.map((row) => (
          <TRow key={rowKey(row)}>
            {columns.map((column) => (
              <TCell
                key={column.key}
                label={labelOf(column)}
                num={column.num}
                actions={column.actions}
                fit={column.fit}
                kind={column.kind}
                className={[cellClassName, column.cell].filter(Boolean).join(' ') || undefined}
              >
                {column.render(row)}
              </TCell>
            ))}
          </TRow>
        ))}
      </TBody>
    </Table>
  );
  const pager = paging && shouldShowPagination({ count: rows.length, pageSize, onPageSizeChange: setPageSize }) ? (
    <div className={PAGER} data-testid="table-pager">
      <Pagination page={current} pageSize={pageSize} count={rows.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
    </div>
  ) : null;
  if (bare) return hollow ? (<>{table}<EmptyState>{empty}</EmptyState></>) : table;
  return (
    <>
      <TableSheet data-testid="table-sheet">
        {table}
        {hollow ? <EmptyState>{empty}</EmptyState> : null}
      </TableSheet>
      {pager}
    </>
  );
}

// What a cursor-paged list (`usePaged`) hands to the table.
export type PagedView<Row> = {
  key: string;
  all: Row[];
  total: number | null;
  ready: boolean;
  hasNext: boolean;
  more: boolean;
  loadMore: () => Promise<boolean>;
  error: string;
  reload: () => Promise<void>;
};

/**
 * A `DataTable` over a `usePaged` list, paged the same way as every full list: the saved page size,
 * the page numbers, previous and next. The server's `total` counts the pages; a page the book does
 * not hold yet is read chunk by chunk when it is asked for, and "all" reads every chunk.
 * Its headers do not sort: the rows on screen are one page of the server's order.
 * It writes no `.pane`: the page owns the pane, since a dialog or a head may live in it.
 * `waiting` keeps the skeleton up for something else the table needs (the package catalog of numbers).
 */
/** The most rows a sorted cursor list reads before it sorts (the API pages by 50; 40 reads). */
const SORT_CAP = 2000;

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
  cards?: boolean;
  striped?: boolean;
  cellClassName?: string;
  headClassName?: string;
}) {
  const { pageSize, setPageSize } = usePrefs();
  const [page, setPage] = useState(1);
  const [seen, setSeen] = useState(list.key);
  // A sorted cursor list (owner 2026-11-11): the first header click reads every page — up to SORT_CAP rows — and the
  // table then sorts and pages the whole set itself, so the order is right across pages, not within one.
  const [sortAll, setSortAll] = useState(false);
  if (list.key !== seen) {
    setSeen(list.key);
    setPage(1);
    setSortAll(false);
  }
  // Without a server total, a pending cursor still counts as one more page so it can be asked for.
  const held = list.all.length + (list.total === null && list.hasNext && pageSize !== 'all' ? pageSize : 0);
  const count = Math.max(list.total ?? 0, held);
  const size = pageSize === 'all' ? Math.max(count, 1) : pageSize;
  const pageCount = Math.max(1, Math.ceil(count / size));
  const current = Math.min(list.key !== seen ? 1 : page, pageCount);
  const wanted = pageSize === 'all' ? Number.POSITIVE_INFINITY : current * size;
  // The rows of the asked page are not all in the book yet: read the next chunk, and again after it lands.
  const short = list.ready && list.all.length < wanted && list.hasNext;
  const { more, loadMore } = list;
  const fillingAll = sortAll && list.ready && list.hasNext && list.all.length < SORT_CAP;
  useEffect(() => {
    if ((short || fillingAll) && !more) void loadMore();
  }, [short, fillingAll, more, loadMore]);

  const filling = pageSize !== 'all' && short && list.all.length <= (current - 1) * size;
  const rows = list.all.slice((current - 1) * size, current * size);
  const choose = (next: typeof pageSize) => {
    setPageSize(next);
    setPage(1);
  };
  const pager = list.ready && shouldShowPagination({ count, pageSize, onPageSizeChange: choose }) ? (
    <div className={PAGER} data-testid="table-pager">
      <Pagination page={current} pageSize={pageSize} count={count} onPageChange={setPage} onPageSizeChange={choose} />
    </div>
  ) : null;
  return (
    <>
      {/* One table element in both modes, so the sort the click set survives the switch to the whole set. */}
      <DataTable
        {...table}
        rows={sortAll ? list.all : rows}
        loading={waiting || !list.ready || (sortAll ? fillingAll : filling)}
        paginate={sortAll}
        onSortStart={sortAll ? undefined : () => setSortAll(true)}
        failed={list.error}
        onRetry={() => void list.reload()}
      />
      {sortAll ? null : pager}
    </>
  );
}
