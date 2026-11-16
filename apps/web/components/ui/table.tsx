'use client';

import * as React from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '../../lib/cn';

/*
 * The data table's parts (Tailwind migration T2.9, ADR 0022), ported from desk/table.css `.data` / `.col-sort` /
 * `.sheet` (pane.css) and the graphite.css table, sheet and phone-card rules over them, in their cascade order:
 * - `TableSheet`: the scroll box around a table; the table scrolls sideways inside it. In `.desk` it keeps its own
 *   height (no flex growth, no minimum height) and scrolls on both axes; on the canvas it is never wider than its
 *   column; on a phone it lets a table drawn as cards overflow (`:has(> table td[data-label])`).
 * - `Table`: full width, separate borders 0 apart, 13px. With `cards` (a `DataTable` whose rows carry `data-label`
 *   cells, outside the lists already drawn as cards) a phone (under 641px) draws every row as a card: the head is
 *   for readers only, the first cell is the card's title across it, every other value sits under its column's name
 *   (`data-label`) two to a row, the actions cell stays in the card's corner, an empty cell is not drawn, and the
 *   zebra tints the whole card (ink at 3%) instead of each cell.
 * - `THeadCell`: sticky at the top (`--rd-z-raised`), no band (the surface), small bold muted names (11.5px, 0.02em),
 *   38px, 8px / 14px padding, a 1px ink-at-11% rule under it, centred but the first one at the reading start, one
 *   line; 1.25 line height on the canvas.
 * - `TCell`: 46px, 8px / 14px padding (8px at the sides on the canvas up to 1100px wide), a 1px transparent rule under
 *   it except on the last row, centred but the first at the reading start, one line; even rows tinted
 *   (`--rd-surface-2` at 55%, unless `striped` is off), the row under the pointer `--rd-accent-soft`. A cell that
 *   holds money uses tabular figures.
 * - Column kinds: `num` (tabular figures), `actions` (6rem, 8px at the sides: the RowMenu column), `fit` (as narrow
 *   as its content; first in a card it sits beside the title instead of being it), and `kind`: `msisdn` (a line
 *   number: at the reading start, semibold, 0.03em, tabular), `when` (a time: tabular), `wrap` (a long text: it
 *   wraps, 16rem at least) and `block` (a cell that draws its own card: no padding, it wraps).
 * - `SortButton`: the header's sort control — the header's own text and weight, the 14px chevrons at 45% (full
 *   once the column is sorted), at the reading start in the first column and centred in the others.
 * - Body rows fade in over 320ms when motion is allowed.
 * Explicit roles (`table`, `rowgroup`, `row`, `columnheader`, `cell`): a phone draws card rows as blocks, which drops
 * the implicit ones.
 * Handles: `data-slot` `table-sheet`, `table` (with `data-cards` while a phone may draw cards), `table-head`,
 * `table-body`, `table-row`, `table-head-cell`, `table-cell`, `table-sort`; the cells carry `data-num`,
 * `data-actions`, `data-fit` and `data-kind` (tests and the remaining legacy content rules read them).
 */

type TableLook = { cards: boolean; striped: boolean };
const TableLookContext = React.createContext<TableLook>({ cards: false, striped: true });
const BodyContext = React.createContext(false);

export type CellKind = 'msisdn' | 'when' | 'wrap' | 'block';

// The canvas narrows every cell's sides to 8px up to 1100px wide (desk/table.css `@media (max-width: 1100px)`); a
// phone's card has no cell padding at all, so in a card table the narrow sides start at 641px.
const NARROW = 'max-[1101px]:[.canvas_&]:px-2';
const NARROW_ABOVE_CARDS = 'sm:max-[1101px]:[.canvas_&]:px-2';

export function TableSheet({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="table-sheet"
      className={cn(
        'overflow-x-auto [.canvas_&]:min-w-0 [.canvas_&]:max-w-full [.desk_&]:min-h-0 [.desk_&]:flex-none [.desk_&]:overflow-y-auto',
        'max-sm:has-[>[data-slot=table]_td[data-label]]:overflow-x-visible',
        className,
      )}
      {...props}
    />
  );
}

export function Table({
  cards = false,
  striped = true,
  className,
  ...props
}: React.ComponentProps<'table'> & {
  /** A phone (under 641px) draws each row as a card. */
  cards?: boolean;
  /** Even rows are tinted. */
  striped?: boolean;
}) {
  const look = React.useMemo(() => ({ cards, striped }), [cards, striped]);
  return (
    <TableLookContext.Provider value={look}>
      <table
        role="table"
        data-slot="table"
        data-cards={cards ? '' : undefined}
        className={cn('w-full border-separate border-spacing-0 text-md', cards && 'max-sm:block max-sm:w-full max-sm:min-w-0', className)}
        {...props}
      />
    </TableLookContext.Provider>
  );
}

export function THead({ className, ...props }: React.ComponentProps<'thead'>) {
  const { cards } = React.useContext(TableLookContext);
  return (
    <thead
      role="rowgroup"
      data-slot="table-head"
      className={cn(cards && 'max-sm:absolute max-sm:size-px max-sm:overflow-hidden max-sm:[clip-path:inset(50%)]', className)}
      {...props}
    />
  );
}

export function TBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  const { cards } = React.useContext(TableLookContext);
  return (
    <BodyContext.Provider value>
      <tbody role="rowgroup" data-slot="table-body" className={cn(cards && 'max-sm:block', className)} {...props} />
    </BodyContext.Provider>
  );
}

export function TRow({ className, ...props }: React.ComponentProps<'tr'>) {
  const { cards } = React.useContext(TableLookContext);
  const body = React.useContext(BodyContext);
  return (
    <tr
      role="row"
      data-slot="table-row"
      className={cn(
        body && 'motion-safe:animate-[rd-fade_320ms_var(--rd-ease-out)_both]',
        body && cards && [
          'max-sm:relative max-sm:grid max-sm:grid-cols-2 max-sm:gap-x-3.5 max-sm:gap-y-2.5',
          'max-sm:border-b max-sm:border-line max-sm:px-4 max-sm:py-3.5 max-sm:even:bg-ink/3',
        ],
        className,
      ) || undefined}
      {...props}
    />
  );
}

type ColumnMarks = {
  /** A number or an amount: tabular figures. */
  num?: boolean;
  /** The operations column that holds a RowMenu. */
  actions?: boolean;
  /** A column as narrow as its content. */
  fit?: boolean;
};

export function THeadCell({ num = false, actions = false, fit = false, className, ...props }: React.ComponentProps<'th'> & ColumnMarks) {
  return (
    <th
      role="columnheader"
      data-slot="table-head-cell"
      data-num={num ? '' : undefined}
      data-actions={actions ? '' : undefined}
      data-fit={fit ? '' : undefined}
      className={cn(
        'sticky top-0 z-raised h-9.5 border-b border-ink/11 bg-surface px-3.5 py-2 text-center align-middle',
        'text-[11.5px] font-bold tracking-[0.02em] whitespace-nowrap text-muted shadow-none first:text-start',
        '[.canvas_&]:leading-tight',
        NARROW,
        num && 'tabular-nums',
        actions && 'w-24 px-2',
        className,
      )}
      {...props}
    />
  );
}

const KIND: Record<CellKind, string> = {
  msisdn: 'text-start font-semibold tracking-[0.03em] tabular-nums',
  when: 'tabular-nums',
  wrap: 'min-w-64 whitespace-normal',
  block: 'p-0 whitespace-normal',
};

// A phone's card (graphite.css, spec 2026-11-11-ui-consistency-pass D7): every value a small grid under its name.
const CARD = [
  'max-sm:grid max-sm:h-auto max-sm:min-w-0 max-sm:content-start max-sm:justify-items-start max-sm:gap-0.75',
  'max-sm:border-0 max-sm:p-0 max-sm:text-start max-sm:whitespace-normal max-sm:wrap-anywhere max-sm:empty:hidden',
  // The first cell is the card's title, across it, clear of the corner's ⋯; a narrow first cell (a picture) sits
  // beside the title, which is then the second cell.
  'max-sm:first:col-span-full max-sm:first:pe-11 max-sm:first:text-md max-sm:first:before:hidden',
  'max-sm:[[data-fit]:first-child+&]:col-span-full max-sm:[[data-fit]:first-child+&]:pe-11',
  'max-sm:[[data-fit]:first-child+&]:text-md max-sm:[[data-fit]:first-child+&]:before:hidden',
];

export function TCell({
  num = false,
  actions = false,
  fit = false,
  kind,
  label,
  className,
  ...props
}: React.ComponentProps<'td'> & ColumnMarks & {
  kind?: CellKind;
  /** The column's name, shown above the value when a phone draws the row as a card (`data-label`). */
  label?: string;
}) {
  const { cards, striped } = React.useContext(TableLookContext);
  return (
    <td
      role="cell"
      data-slot="table-cell"
      data-label={label || undefined}
      data-num={num ? '' : undefined}
      data-actions={actions ? '' : undefined}
      data-fit={fit ? '' : undefined}
      data-kind={kind}
      className={cn(
        'h-11.5 border-b border-transparent bg-transparent px-3.5 py-2 text-center align-middle whitespace-nowrap first:text-start',
        '[tbody>tr:last-child>&]:border-b-0 has-[.money]:tabular-nums',
        kind !== 'block' && (cards ? NARROW_ABOVE_CARDS : NARROW),
        // The tints sit on the cells; a phone's card takes them on the whole row instead.
        striped && (cards ? 'sm:[tr:nth-child(even)>&]:bg-surface-2/55' : '[tr:nth-child(even)>&]:bg-surface-2/55'),
        cards ? 'sm:[tbody>tr:hover>&]:bg-accent-soft' : '[tbody>tr:hover>&]:bg-accent-soft',
        num && 'tabular-nums',
        actions && 'w-24 px-2',
        kind && KIND[kind],
        cards && CARD,
        cards && fit && 'max-sm:first:col-auto max-sm:first:pe-0',
        cards && actions && 'max-sm:absolute max-sm:top-2 max-sm:end-2 max-sm:w-auto',
        cards && label && 'max-sm:before:text-[11.5px] max-sm:before:font-semibold max-sm:before:text-muted max-sm:before:content-[attr(data-label)]',
        className,
      )}
      {...props}
    />
  );
}

export function SortButton({
  order,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<'button'>, 'type'> & {
  /** The column's order now: ascending, descending or none. */
  order: 'asc' | 'desc' | null;
}) {
  const Icon = order === 'asc' ? ChevronUp : order === 'desc' ? ChevronDown : ChevronsUpDown;
  return (
    <button
      type="button"
      data-slot="table-sort"
      className={cn(
        'inline-flex max-w-full cursor-pointer items-center justify-center gap-1 border-0 bg-transparent p-0 text-inherit [font:inherit]',
        '[th:first-child>&]:justify-start',
        className,
      )}
      {...props}
    >
      <span>{children}</span>
      <Icon size={14} aria-hidden="true" className={cn('size-3.5 flex-none', order ? 'opacity-100' : 'opacity-45')} />
    </button>
  );
}
