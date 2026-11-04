import { isValidElement, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { EmptyState } from './empty-state';
import { TableSkeleton } from './loading';
import { Pagination, shouldShowPagination } from './ui/pagination';
import { usePrefs } from '../lib/prefs';

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
 * A full list pages itself from the saved page size. A cursor list (`PagedTable`) passes `paginate={false}`.
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
  skeleton,
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  loading?: boolean;
  empty?: ReactNode;
  keepHead?: boolean;
  bare?: boolean;
  paginate?: boolean;
  skeleton?: { rows?: number; columns?: number };
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

  if (loading) {
    return (
      <div className="sheet">
        <TableSkeleton rows={skeleton?.rows ?? 5} columns={skeleton?.columns ?? columns.length} />
      </div>
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
  const table = (
    <table className="data">
      <thead>
        <tr>
          {columns.map((item) => {
            const active = sort?.key === item.key;
            const dir = active ? sort.dir : null;
            return (
              <th
                key={item.key}
                className={classes(item.fit && 'fit', item.num && 'num', item.actions && 'row-actions')}
                aria-sort={item.actions ? undefined : dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
              >
                {item.actions ? item.header : (
                  <button
                    type="button"
                    className="col-sort"
                    onClick={() => {
                      setSort((current) => (
                        current?.key === item.key
                          ? { key: item.key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
                          : { key: item.key, dir: 'asc' }
                      ));
                      setPage(1);
                    }}
                  >
                    <span>{item.header}</span>
                    {dir === 'asc' ? <ChevronUp size={14} aria-hidden="true" /> : dir === 'desc' ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronsUpDown size={14} aria-hidden="true" />}
                  </button>
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {visible.map((row) => (
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
  const pager = paging && shouldShowPagination({ count: rows.length, pageSize, onPageSizeChange: setPageSize }) ? (
    <div className="table-pager">
      <Pagination page={current} pageSize={pageSize} count={rows.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
    </div>
  ) : null;
  if (bare) return hollow ? (<>{table}<EmptyState>{empty}</EmptyState></>) : table;
  return (
    <>
      <div className="sheet">
        {table}
        {hollow ? <EmptyState>{empty}</EmptyState> : null}
      </div>
      {pager}
    </>
  );
}

// What a cursor-paged list (`usePaged`) hands to the table.
export type PagedView<Row> = {
  rows: Row[];
  ready: boolean;
  page: number;
  pageCount: number;
  hasNext: boolean;
  more: boolean;
  goTo: (page: number) => void;
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
  const showPager = list.ready && (list.pageCount > 1 || list.hasNext);
  return (
    <>
      <DataTable {...table} rows={list.rows} loading={waiting || !list.ready} paginate={false} />
      {showPager && <PageNav list={list} />}
    </>
  );
}

function PageNav<Row>({ list }: { list: PagedView<Row> }) {
  const { t } = usePrefs();
  const numbers = Array.from({ length: list.pageCount }, (_, index) => index + 1);
  const pending = list.hasNext && list.page === list.pageCount ? list.page + 1 : null;
  return (
    <nav className="page-nav" aria-label={t.pages}>
      <button type="button" aria-label={t.pagePrev} disabled={list.more || list.page <= 1} onClick={() => void list.goTo(list.page - 1)}>‹</button>
      {numbers.map((number) => (
        <button key={number} type="button" aria-current={number === list.page ? 'page' : undefined} disabled={list.more} onClick={() => void list.goTo(number)}>{number}</button>
      ))}
      {pending !== null && (
        <button type="button" disabled={list.more} onClick={() => void list.goTo(pending)}>{pending}</button>
      )}
      <button type="button" aria-label={t.pageNext} disabled={list.more || !list.hasNext} onClick={() => void list.goTo(list.page + 1)}>›</button>
      <span className="hint">{t.shownCount.replace('{n}', String(list.rows.length))}</span>
    </nav>
  );
}
