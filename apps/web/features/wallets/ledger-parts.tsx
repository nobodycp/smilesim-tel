import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../../lib/cn';

/*
 * The parts the ledgers share (finance, wallet, provider operations, profits; Tailwind migration T4.7, ADR 0022),
 * ported from graphite.css, desk/table.css, desk/components.css and desk/frame.css in their cascade order.
 */

/** The reason tag's tones: a sale green, money held amber, money given back red, funding violet, the rest muted. */
export type ReasonTone = 'leaf' | 'amber' | 'alarm' | 'plum' | 'mute';

const REASON_TONE: Record<ReasonTone, string> = {
  leaf: 'bg-success-soft text-success',
  amber: 'bg-warning-soft text-warning',
  alarm: 'bg-danger-soft text-danger',
  // The main agent's hue at 16% on the cell (graphite `color-mix(in srgb, --rd-layer-main 16%, transparent)`).
  plum: 'bg-layer-main/16 text-layer-main',
  mute: 'bg-surface-2 text-muted',
};

/*
 * A ledger row's reason (legacy `.reason` / `.r-*`, graphite.css): an inline row, items centred, 22px high, 8px at the
 * sides, 4px corners, 11.5px bold on one line, the tone's soft fill and text. `data-slot="reason-tag"`.
 */
export function ReasonTag({ tone, className, ...props }: ComponentPropsWithoutRef<'span'> & { tone: ReasonTone }) {
  return (
    <span
      data-slot="reason-tag"
      className={cn('inline-flex h-5.5 items-center whitespace-nowrap rounded-xs px-2 text-[11.5px] font-bold', REASON_TONE[tone], className)}
      {...props}
    />
  );
}

/*
 * The reason cell (legacy `.kind-cell`, desk/table.css): the tag and its badges in a wrapping inline row, 4px between
 * rows and 8px between items. A shekel figure in one of its badges is bold in the badge's colour (components/desk.tsx
 * read `.kind-cell [data-slot=badge]` for this).
 */
export const kindCellClass = cn(
  'inline-flex flex-wrap items-center gap-x-2 gap-y-1',
  '[&_[data-slot=badge]_[data-slot=money]]:font-bold [&_[data-slot=badge]_[data-slot=money]]:text-inherit',
);

/*
 * The second line of a table cell (legacy `[data-slot='table'] .sub`, graphite.css): its own line, 11.5px `--rd-muted`
 * at normal weight, 1.3 line height.
 */
export const cellSubClass = 'block text-[11.5px] leading-[1.3] font-normal text-muted';

/*
 * The page head's actions (legacy `.page-actions`, desk/frame.css): a wrapping inline row, items centred, 8px apart.
 */
export function PageActions({ children }: { children: ReactNode }) {
  return <div className="inline-flex flex-wrap items-center gap-2">{children}</div>;
}

/*
 * A section's head above its card (legacy `.section-head`, desk/components.css): one row, the title at the start,
 * 8px apart; the title with no margin, 15px (`--rd-text-lg`), extra bold.
 */
export function SectionHead({ title }: { title: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="m-0 text-lg font-extrabold">{title}</h2>
    </div>
  );
}
