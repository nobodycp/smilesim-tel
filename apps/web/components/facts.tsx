'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { figureCardClass, riseInClass } from './stat';

// One label/value primitive in three densities (DESIGN.md → Key/value):
// - `tiles` (default): label and value side by side in bordered tiles that repeat across the width; the number card,
//   dialogs.
// - `cards`: a summary card per fact, the value large, an optional icon and tone; the head of the account page.
// - `list`: a compact ruled list for a narrow rail; the task ticket.
type Variant = 'tiles' | 'cards' | 'list';
type Tone = 'good' | 'warn';

/*
 * The look (Tailwind migration T3.3, ADR 0022), ported from desk/numbers.css `.detail-rows`, desk/users.css
 * `.fact-grid` / `.fact-card` / `.fact-mark`, desk/tasks.css `.task-facts` and graphite.css, in their cascade order:
 * - tiles: as many columns of at least 16rem (or the whole width) as fit, 8px apart; each fact a row at least 38px
 *   high clipped to 6px corners with a 1px `--rd-line-strong` edge: its name on `--rd-surface-2` (at least 7.5rem,
 *   12px sides, 12px `--rd-muted` 600, one line; 6.5rem and 10px sides at 420px and under), a `--rd-line-strong`
 *   rule, the value on `--rd-surface` (6px / 12px padding, 13.5px ink bold, breaking anywhere, its `bdi` figures
 *   tabular and spaced 0.02em);
 * - cards: columns of at least 180px (200px in the desk column; two columns 10px apart at 640px and under), 12px
 *   apart; each fact a figure card (`figureCardClass`) on `--rd-surface` with 16px padding, the name and value at the
 *   start (12px `--rd-muted` 500; 18px ink 600, 1.25 line height, 4px under) and a 36px mark at the end (6px corners,
 *   `--rd-ink-2` on `--rd-surface-2`, a 17px glyph); `good` draws the value and the mark in `--rd-success` on
 *   `--rd-success-soft`, `warn` in `--rd-warning`; the cards rise in (`riseInClass`);
 * - list: a column of ruled rows (5px top and bottom, a `--rd-line-soft` rule under each but the last), the name
 *   column at least 4.5rem and at most 42%, 8px to the value, both on one baseline; the name 11px `--rd-muted` bold,
 *   the value 13px ink bold at the reading start, breaking anywhere, its `bdi` figures tabular.
 */
const LIST: Record<Variant, string> = {
  tiles: 'm-0 grid grid-cols-fit-card gap-2',
  cards: cn(
    'm-0 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3 sm:[.desk_&]:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]',
    'max-sm:grid-cols-2 max-sm:gap-2.5',
    riseInClass,
  ),
  list: 'm-0 grid gap-0',
};

const ROW = {
  tiles: 'flex min-h-9.5 min-w-0 items-stretch overflow-hidden rounded-sm border border-line-strong bg-surface-2',
  list: 'grid grid-cols-[minmax(4.5rem,42%)_minmax(0,1fr)] items-baseline gap-x-2 border-b border-line-soft py-1.25 last:border-b-0',
} as const;

const NAME = {
  tiles: 'm-0 flex min-w-30 flex-none items-center px-3 text-sm font-semibold whitespace-nowrap text-muted max-[421px]:min-w-26 max-[421px]:px-2.5',
  list: 'text-xs font-bold text-muted',
} as const;

const VALUE = {
  tiles: cn(
    'm-0 flex min-w-0 flex-1 items-center border-s border-line-strong bg-surface px-3 py-1.5 text-block font-bold text-ink wrap-anywhere',
    '[&_bdi]:tracking-head [&_bdi]:tabular-nums',
  ),
  list: 'm-0 text-start text-md font-bold text-ink wrap-anywhere [&_bdi]:tabular-nums',
} as const;

const CARD_TONE: Record<Tone, { value: string; mark: string }> = {
  good: { value: 'text-success', mark: 'bg-success-soft text-success' },
  warn: { value: 'text-warning', mark: 'bg-warning-soft text-warning' },
};

const VariantOf = createContext<Variant>('tiles');

export function Facts({ variant = 'tiles', children }: { variant?: Variant; children: ReactNode }) {
  return (
    <VariantOf.Provider value={variant}>
      <dl className={LIST[variant]} data-slot="facts" data-variant={variant}>{children}</dl>
    </VariantOf.Provider>
  );
}

export function Fact({ label, icon, tone, children }: { label: ReactNode; icon?: ReactNode; tone?: Tone; children: ReactNode }) {
  const variant = useContext(VariantOf);
  if (variant === 'cards') {
    return (
      <div
        className={cn(figureCardClass, 'flex min-w-0 items-start justify-between gap-3 bg-surface p-4')}
        data-slot="fact-card"
      >
        <div>
          <dt className="m-0 text-sm font-medium text-muted">{label}</dt>
          <dd className={cn('mx-0 mt-1 mb-0 text-2xl leading-1-25 font-semibold', tone ? CARD_TONE[tone].value : 'text-ink')}>{children}</dd>
        </div>
        {icon ? (
          <span
            className={cn(
              'inline-flex size-9 flex-none items-center justify-center rounded-sm [&_svg]:size-4.25',
              tone ? CARD_TONE[tone].mark : 'bg-surface-2 text-ink-2',
            )}
            aria-hidden="true"
          >
            {icon}
          </span>
        ) : null}
      </div>
    );
  }
  return (
    <div className={ROW[variant]} data-testid="fact">
      <dt className={NAME[variant]}>{label}</dt>
      <dd className={VALUE[variant]}>{children}</dd>
    </div>
  );
}
