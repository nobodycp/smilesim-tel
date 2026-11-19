import { Fragment, isValidElement, useEffect, useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn';
import { EmptyState } from './empty-state';
import { Fact, Facts } from './facts';
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
  // A column that leaves the row when the table does not fit its width, read under the row's arrow instead (`more`):
  // the columns marked 1 leave first, then 2, and so on; a phone's cards drop every one of them.
  fold?: number;
};

/** One labelled fact under a row's arrow that has no column (`more`). */
export type RowFact = { key: string; label: ReactNode; value: ReactNode };

/**
 * The row's arrow (spec 2026-11-19-finance-ledger-columns): `facts` are what a row says beyond its columns; the arrow
 * opens them under the row, after the folded columns' values. `label` names the arrow to readers.
 */
export type RowMore<Row> = { label: string; facts: (row: Row) => RowFact[] };

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

/*
 * The row's arrow: the ⋯ trigger's look (components/row-menu.tsx) — 28px, no border or fill, 6px corners,
 * `--rd-faint`; `--rd-surface-3` and ink under the pointer and while open — with the crimson focus ring; the 16px
 * chevron points down and turns over (180°, 200ms) while the row is open, the same in both directions.
 */
const ARROW = cn(
  'group inline-flex size-7 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-faint',
  'hover:bg-surface-3 hover:text-ink aria-expanded:bg-surface-3 aria-expanded:text-ink',
  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent',
);

/*
 * A table with an arrow writes a row's opened part under it only while it is open, so the zebra cannot count rows: it
 * is laid by the row's place in the list instead — every second row and its opened part take the tint
 * (`--rd-surface-2` at 55% on the cells; a phone's card ink at 3%, the card's own even-row tint lifted from the rest).
 * Under the pointer a row's opened part takes the row's hover too.
 */
const TINT = { cards: 'sm:[tr>&]:bg-surface-2/55', plain: '[tr>&]:bg-surface-2/55' };
const MORE_HOVER = { cards: 'sm:[tbody>tr:hover+tr>&]:bg-accent-soft', plain: '[tbody>tr:hover+tr>&]:bg-accent-soft' };
const CARD_TINT = 'max-sm:bg-ink/3';
const CARD_PLAIN = 'max-sm:even:bg-transparent';

/** A phone's width (under 641px, `max-sm:`), where a table may draw its rows as cards; false on the server. */
const PHONE = '(width < 641px)';
function subscribePhone(onChange: () => void) {
  const media = window.matchMedia(PHONE);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
const usePhone = () => useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE).matches, () => false);

/**
 * How many fold steps (`Column.fold`) the table takes: none while it fits its box; then one more step each time the
 * table overflows the box (watched on both, so each step is measured again), until it fits or every step is taken;
 * every step on a phone that draws cards. The box widening, or the rows changing, starts again from none.
 */
function useFolds(table: HTMLTableElement | null, steps: number, cards: boolean, stamp: string) {
  const [level, setLevel] = useState(0);
  const phone = usePhone();
  const [seen, setSeen] = useState(stamp);
  if (stamp !== seen) {
    setSeen(stamp);
    setLevel(0);
  }
  useEffect(() => {
    const box = table?.parentElement;
    if (!steps || !table || !box) return undefined;
    let width = box.clientWidth;
    const observer = new ResizeObserver(() => {
      const next = box.clientWidth;
      const wider = next > width;
      width = next;
      if (wider) setLevel(0);
      else if (box.scrollWidth > box.clientWidth + 1) setLevel((current) => Math.min(current + 1, steps));
    });
    observer.observe(box);
    observer.observe(table);
    return () => observer.disconnect();
  }, [table, steps]);
  return steps ? (phone && cards ? steps : level) : 0;
}

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
 * `more` gives each row an arrow in a last column that opens the row's remaining facts under it; with it, the columns
 * marked `fold` leave the row (step by step, measured) when the table would not fit its width, and are read there:
 * the table never scrolls sideways for them (the finance list, spec 2026-11-19-finance-ledger-columns).
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
  more,
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
  /**
   * The row's arrow: a last column whose button (`aria-expanded`) opens the row's remaining facts under it — the
   * values of the columns folded away (`Column.fold`) and `more.facts` — labelled, one a line. A row with nothing
   * more has no arrow.
   */
  more?: RowMore<Row>;
}) {
  const { pageSize, setPageSize, locale } = usePrefs();
  const [tableEl, setTableEl] = useState<HTMLTableElement | null>(null);
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const idBase = useId();
  const steps = Math.max(0, ...columns.map((item) => item.fold ?? 0));
  const folded = useFolds(tableEl, steps, cards, steps ? rows.map(rowKey).join('\n') : '');
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
  // cards apply only while at least one row holds a named value.
  const labelOf = (item: Column<Row>) => (item.actions ? undefined : nodeText(item.header) || undefined);
  const carded = cards && visible.length > 0 && columns.some((item) => labelOf(item) !== undefined);
  // The columns the width keeps; the folded ones are read under the arrow.
  const shown = columns.filter((item) => !item.fold || item.fold > folded);
  const away = columns.filter((item) => item.fold && item.fold <= folded);
  const look = carded ? 'cards' : 'plain';
  /** What the row's arrow opens: the folded columns that hold a value, then the row's own facts. */
  const factsOf = (row: Row): RowFact[] => [
    ...away.flatMap((item) => {
      const value = item.render(row);
      return blank(nodeText(value)) ? [] : [{ key: item.key, label: item.header, value }];
    }),
    ...(more?.facts(row) ?? []),
  ];
  const toggle = (key: string) => setOpened((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const table = (
    <Table ref={setTableEl} cards={carded} striped={striped && !more} data-testid="data-table">
      <THead>
        <TRow>
          {shown.map((item) => {
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
          {more ? (
            <THeadCell className={cn('w-10 px-2', headClassName)}>
              <span className="sr-only">{more.label}</span>
            </THeadCell>
          ) : null}
        </TRow>
      </THead>
      <TBody>
        {visible.map((row, index) => {
          const key = rowKey(row);
          const tinted = Boolean(more) && striped && index % 2 === 1;
          const cells = shown.map((column) => (
            <TCell
              key={column.key}
              label={labelOf(column)}
              num={column.num}
              actions={column.actions}
              fit={column.fit}
              kind={column.kind}
              className={cn(cellClassName, column.cell, tinted && TINT[look]) || undefined}
            >
              {column.render(row)}
            </TCell>
          ));
          if (!more) return <TRow key={key}>{cells}</TRow>;
          const facts = factsOf(row);
          const open = facts.length > 0 && opened.has(key);
          const detailId = `${idBase}-more-${key}`;
          return (
            <Fragment key={key}>
              <TRow className={tinted ? CARD_TINT : CARD_PLAIN}>
                {cells}
                <TCell
                  className={cn(
                    'w-10 px-2',
                    cellClassName,
                    tinted && TINT[look],
                    carded && 'max-sm:absolute max-sm:top-2 max-sm:end-2 max-sm:w-auto',
                  )}
                >
                  {facts.length ? (
                    <button type="button" className={ARROW} aria-expanded={open} aria-controls={open ? detailId : undefined} aria-label={more.label} title={more.label} onClick={() => toggle(key)} data-testid="row-more">
                      <ChevronDown size={16} aria-hidden="true" className="size-4 transition-transform duration-base ease-standard group-aria-expanded:rotate-180" />
                    </button>
                  ) : null}
                </TCell>
              </TRow>
              {open ? (
                <TRow id={detailId} className={tinted ? CARD_TINT : CARD_PLAIN} data-testid="row-more-part">
                  <TCell
                    colSpan={shown.length + 1}
                    className={cn('h-auto py-2.5 whitespace-normal max-sm:first:pe-0', tinted && TINT[look], MORE_HOVER[look])}
                  >
                    <div className="max-w-120">
                      <Facts variant="list">
                        {facts.map((fact) => <Fact key={fact.key} label={fact.label}>{fact.value}</Fact>)}
                      </Facts>
                    </div>
                  </TCell>
                </TRow>
              ) : null}
            </Fragment>
          );
        })}
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
  /** The server counted up to its cap and there are more (database plan DB.8): `total` is the cap. */
  capped?: boolean;
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
  more?: RowMore<Row>;
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
  // Without a server total, or past a capped one (database plan DB.8), a pending cursor still counts as one more page
  // so it can be asked for.
  const held = list.all.length + ((list.total === null || list.capped) && list.hasNext && pageSize !== 'all' ? pageSize : 0);
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
      <Pagination page={current} pageSize={pageSize} count={count} moreThan={list.capped && list.hasNext ? Math.max(list.total ?? 0, list.all.length) : undefined} onPageChange={setPage} onPageSizeChange={choose} />
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
