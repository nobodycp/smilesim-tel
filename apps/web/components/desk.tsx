'use client';

import { type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { type Outcome } from '../lib/api';
import { cn } from '../lib/cn';
import { formatShekel } from '../lib/money';
import { useDesk } from '../lib/desk-session';
import { usePageTitle } from '../lib/page-title';
import { usePrefs } from '../lib/prefs';
import { PageAlert } from './dialog';
import { PageSkeleton } from './loading';
import { Segmented, SegmentedItem } from './ui/segmented';

export { actionName, applyNote, layerName, lineStatus, taskStatus } from './names';

/*
 * The desk frame (Tailwind migration T3.3, ADR 0022), ported from desk/frame.css, desk/pane.css, forms.css and
 * graphite.css in their cascade order:
 * - the column: a flex column 14px apart that fills the canvas (`flex: 1`, full width, no minimum height); one that
 *   holds a `.stack` sizes to its content instead. It keeps the `desk` class: the screens' legacy rules (`.desk > .pane`,
 *   `.desk > .stack`, `.desk input`'s 34px / 44px, the filter panel's fields, the user terms' price fields) and the
 *   primitives (`[.desk>&]` in Alert, Tabs, TableSheet, DateField) read it as their context until those screens move;
 * - the page head: one wrapping row, the title at the start and the action at the end, 8px apart, the lede on its own
 *   line under them; it rises in (8px, 420ms) when motion is allowed, as the canvas's page heads did;
 * - the title: the `h1` element rule (forms.css: no margin, bold, 1.25 line height) at 1.25rem with no letter
 *   spacing (`.canvas .page-head h1`);
 * - the lede: 13px `--rd-muted` at the reading start, 4px under the title.
 */
const DESK = 'desk flex min-h-0 w-full flex-1 flex-col gap-3.5 has-[>.stack]:min-h-auto has-[>.stack]:flex-none has-[>.stack]:overflow-visible';

/** The desk's column without its head: the error and not-found pages. */
export function DeskColumn({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn(DESK, className)} {...props} />;
}

export function Desk({
  title,
  lede,
  action,
  error,
  note,
  children,
}: {
  title: ReactNode;
  lede: string;
  action?: ReactNode;
  error: string;
  note: string;
  children: ReactNode;
}) {
  const { ready } = useDesk();
  usePageTitle(typeof title === 'string' ? title : '');
  // The page's own loads already started; the content waits for the session so a guarded page
  // never flashes before the account is known.
  if (!ready) return <PageSkeleton />;

  return (
    <DeskColumn data-testid="desk">
      <header
        className="flex flex-wrap items-center justify-between gap-2 motion-safe:[.canvas-inner>*>&]:animate-rise"
        data-slot="page-head"
        data-testid="page-head"
      >
        <h1 className="m-0 text-page tracking-normal">{title}</h1>
        {action}
        {lede ? <p className="mx-0 mt-1 mb-0 min-w-full basis-full text-start text-md text-muted" data-testid="page-lede">{lede}</p> : null}
      </header>
      <PageAlert error={error} note={note}>
        {children}
      </PageAlert>
    </DeskColumn>
  );
}

/*
 * A pane: the card a desk's content sits in (legacy `.pane`, desk/pane.css with graphite.css, table.css and the desk
 * scroll model): clipped to 6px corners on `--rd-surface` with a 1px inset `--rd-line` edge and no border; inside the
 * canvas it never widens its column. As a direct child of the desk column it is a full-width flex column that keeps
 * its own height (graphite: a list's card ends with its content); in a `.stack` of the desk it is a block of its own
 * height. One that holds a table takes the card corners (8px) and the frame shadow instead of the edge; one right
 * after a filter bar (`[data-slot=filter-bar]`) tucks under it (its start corners square, pulled up by the gap and the
 * bar's edge), unless the bar stands loose on the page. `data-slot="pane"`: the legacy rules that style what sits in a
 * pane (`.pane label`, `.pane input`, `.pane .hint`, `.pane form`, its tabs, the empty line, drop zones, price fields)
 * read `:is(.pane, [data-slot='pane'])` until their screens move. The head and body inside stay `.pane-head` /
 * `.pane-body` until the first screen that ports them.
 */
const PANE = cn(
  'overflow-hidden rounded-sm border-0 bg-surface inset-ring inset-ring-line',
  '[.canvas_&]:min-w-0 [.canvas_&]:max-w-full',
  '[.desk>&]:flex [.desk>&]:w-full [.desk>&]:min-h-0 [.desk>&]:flex-none [.desk>&]:flex-col',
  '[.desk>.stack>&]:block [.desk>.stack>&]:min-h-auto [.desk>.stack>&]:flex-none',
  'has-[[data-slot=table]]:rounded-card has-[[data-slot=table]]:inset-ring-0 has-[[data-slot=table]]:shadow-frame',
  '[[data-slot=filter-bar]+&]:-mt-[calc(var(--rd-space-3-5)+1px)] [[data-slot=filter-bar]+&]:rounded-ss-none [[data-slot=filter-bar]+&]:rounded-se-none',
  '[[data-slot=filter-bar][data-loose]+&]:mt-0 [[data-slot=filter-bar][data-loose]+&]:rounded-ss-sm [[data-slot=filter-bar][data-loose]+&]:rounded-se-sm',
);

export function Pane({ className, ...props }: ComponentPropsWithoutRef<'section'>) {
  return <section data-slot="pane" className={cn(PANE, className)} {...props} />;
}

/*
 * A shekel figure (legacy `.money` / `.cur`, base.css, desk/table.css and graphite.css): bold tabular figures; a
 * negative one in `--rd-danger`, a signed positive one in `--rd-success` with its plus; `muted` (a reference figure, a
 * default beside a custom value) in `--rd-muted` at 600, also when negative. The shekel sign follows, 1px off, at
 * 0.8em and normal weight, `--rd-muted`, or the figure's own colour at 75% on a coloured one. The places that recolour
 * it keep doing so: a figure tile's success / danger value, a badge in a ledger's kind cell (its colour), a price
 * dialog's buy line (ink), a muted default beside a price field (12px). `data-slot="money"`: TCell reads it.
 */
const MONEY_PLACES = [
  '[.figure-tile-value.tone-success_&]:text-success [.figure-tile-value.tone-danger_&]:text-danger',
  '[.kind-cell_[data-slot=badge]_&]:font-bold [.kind-cell_[data-slot=badge]_&]:text-inherit',
  '[.terms-price-form_.terms-price-buy_&]:font-bold [.terms-price-form_.terms-price-buy_&]:text-ink',
];

// `muted` renders a reference figure (a default beside a custom value); `signed` colours a
// difference and prefixes the plus.
export function Money({ value, muted, signed }: { value: number; muted?: boolean; signed?: boolean }) {
  const negative = value < 0;
  const positive = Boolean(signed) && value > 0;
  return (
    // Graphite: the shekel sign small and quiet after the figure; the text reads the same («12.50 ₪»).
    <span
      className={cn(
        'font-bold tabular-nums',
        muted ? 'font-semibold text-muted [.price-pair>&]:text-sm' : negative ? 'text-danger' : positive ? 'text-success' : '',
        MONEY_PLACES,
      )}
      data-slot="money"
      data-testid="money"
      dir="ltr"
    >
      {positive ? '+' : ''}{formatShekel(value).replace(/ ₪$/, '')}
      <small className={cn('ms-px text-[0.8em] font-normal', negative || positive ? 'text-inherit opacity-75' : 'text-muted')}> ₪</small>
    </span>
  );
}

/*
 * The outcome pick (success / failure) with its name before it, 4px apart: a column in a dialog or a pane, one row
 * in a filter bar (its name 12px `--rd-muted` 600; spread to both ends in the phone's open filter drawer); in a pane
 * the name is 12px `--rd-muted` with no margin. The pick is the Segmented control (Tailwind migration T2.3), which
 * draws the legacy `.seg` look. `data-slot="outcome-pick"`: the canvas's `:has(.stack)` sizing rule (frame.css) reads
 * it, as it read the legacy `.stack` this was.
 */
const OUTCOME_PICK = cn(
  'grid content-start gap-1 *:min-w-0 [.canvas_&]:min-w-0 [.canvas_&]:max-w-full',
  '[[data-slot=filter-panel]>&]:inline-flex [[data-slot=filter-panel]>&]:flex-row [[data-slot=filter-panel]>&]:items-center',
  'max-md:[[data-slot=filter-bar][data-open]_[data-slot=filter-panel]>&]:justify-between',
  // The number card's operations tab (legacy `.line-ops > .stack`, desk/numbers.css): as wide as its content.
  '[.line-ops>&]:w-max [.line-ops>&]:max-w-full [.line-ops>&]:justify-items-start',
);
const OUTCOME_NAME = cn(
  '[[data-slot=filter-panel]>*>&]:text-sm [[data-slot=filter-panel]>*>&]:font-semibold [[data-slot=filter-panel]>*>&]:text-muted',
  '[:is(.pane,[data-slot=pane])_&]:m-0 [:is(.pane,[data-slot=pane])_&]:text-sm [:is(.pane,[data-slot=pane])_&]:text-muted',
);

export function OutcomePick({
  value,
  onChange,
}: {
  value: Outcome;
  onChange: (value: Outcome) => void;
}) {
  const { t } = usePrefs();
  return (
    <div className={OUTCOME_PICK} data-slot="outcome-pick">
      <span className={OUTCOME_NAME}>{t.outcome}</span>
      <Segmented aria-label={t.outcome} value={value} onValueChange={(next) => onChange(next as Outcome)}>
        <SegmentedItem value="success">{t.success}</SegmentedItem>
        <SegmentedItem value="fail">{t.failure}</SegmentedItem>
      </Segmented>
    </div>
  );
}

export function latinWhen(value: string, precise = false): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, '0');
  const clock = precise
    ? `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    : `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock}`;
}

export function whole(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}
