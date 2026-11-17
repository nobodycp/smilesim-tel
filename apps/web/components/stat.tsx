import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Icon, type IconName } from './icon';

type StatTone = 'success' | 'warning' | 'danger' | 'muted';

/*
 * The figure cards (ADR 0022).
 *
 * `pointerGlowClass` is the figure tile's light (one variant for Stat, the fact cards, the wallet and home tiles, the
 * line operation cards, the package cards): a soft `--rd-glow` light 180px
 * round under the pointer that fades in over 180ms (the shell sets `--mx` / `--my` on a card it finds by
 * `data-slot="stat"` / `"fact-card"`), on an `::after` layer under the content with the card's corners. When motion is
 * allowed the card lifts 2px under the pointer; the lift is a `transform`, so a card that rose in with its row keeps
 * the rise's end state. The card sets its own position-free look (corners, edge, fill).
 *
 * `figureCardClass` is the card both Stat and a `Facts variant="cards"` fact draw (graphite's figure and fact cards):
 * that light, 6px corners, no border, a 1px inset `--rd-line` edge, and the tag's cut corner (`--rd-cut`) at the top
 * inline end.
 */
export const pointerGlowClass = cn(
  'relative isolate',
  "after:pointer-events-none after:absolute after:inset-0 after:-z-1 after:rounded-[inherit] after:content-['']",
  'after:bg-radial-[180px_circle_at_var(--mx,50%)_var(--my,0%)] after:from-glow after:to-transparent after:to-70%',
  'after:opacity-0 after:transition-opacity after:duration-base after:ease-standard hover:after:opacity-100',
  'motion-safe:transition-transform motion-safe:duration-base motion-safe:ease-out motion-safe:hover:[transform:translateY(-2px)]',
);

export const figureCardClass = cn(
  pointerGlowClass,
  'rounded-sm border-0 inset-ring inset-ring-line',
  '[clip-path:polygon(0_0,calc(100%_-_var(--rd-cut))_0,100%_var(--rd-cut),100%_100%,0_100%)]',
  'rtl:[clip-path:polygon(var(--rd-cut)_0,100%_0,100%_100%,0_100%,0_var(--rd-cut))]',
);

/*
 * A row of cards rising in: each child rises 8px into place over 420ms, the second to the fifth 40ms after the one
 * before (StatRow and `Facts variant="cards"`), when motion is allowed.
 */
export const riseInClass = cn(
  'motion-safe:*:animate-rise',
  'motion-safe:[&>:nth-child(2)]:[animation-delay:40ms] motion-safe:[&>:nth-child(3)]:[animation-delay:80ms]',
  'motion-safe:[&>:nth-child(4)]:[animation-delay:120ms] motion-safe:[&>:nth-child(n+5)]:[animation-delay:160ms]',
);

const ICON_TONE: Record<StatTone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  muted: 'text-muted',
};

/**
 * A figure card (spec 2026-11-08-inner-pages-refresh, §3): the label at the start, a small icon at the end, the value
 * large under them, then an optional caption. `tone` colours the icon. `highlight` tints the card: the one figure that
 * matters most on the screen. `progress` (0–1) draws a thin bar under the value, for a share such as the ceiling used.
 *
 * Look: a grid of the label column and the icon, 6px between rows and 12px between columns, at least 92px high,
 * 14px / 16px padding on `--rd-surface` (12px all round and no minimum under 768px); the label 12px `--rd-muted` 600;
 * the icon 17px, `--rd-muted` or its tone; the value across the card in ink, 1.45rem bold (1.2rem under 768px),
 * tabular; the bar 4px, a pill of ink on `--rd-surface-3`; the caption 12px `--rd-muted` 500. `highlight` draws the
 * value and the icon in `--rd-success` (graphite keeps the card on the surface).
 */
export function Stat({
  icon,
  tone = 'muted',
  value,
  label,
  meta,
  highlight = false,
  progress,
}: {
  /** Left out on the report pages, whose tiles carry no icon in the design. */
  icon?: IconName;
  tone?: StatTone;
  value: ReactNode;
  label: string;
  meta?: ReactNode;
  highlight?: boolean;
  progress?: number | null;
}) {
  const share = progress == null ? null : Math.min(1, Math.max(0, progress));
  return (
    <article
      className={cn(
        figureCardClass,
        'grid min-h-23 grid-cols-title-end content-start gap-x-3 gap-y-1.5 bg-surface px-4 py-3.5 max-md:min-h-0 max-md:p-3',
      )}
      data-slot="stat"
      data-testid="stat"
      data-highlight={highlight ? '' : undefined}
    >
      <span className="text-sm leading-1-3 font-semibold text-muted">{label}</span>
      {icon ? (
        <span className={cn('grid place-items-center [&_svg]:size-4.25', highlight ? 'text-success' : ICON_TONE[tone])} aria-hidden="true">
          <Icon name={icon} />
        </span>
      ) : null}
      <strong
        className={cn(
          'col-span-full text-figure leading-1-15 font-bold tracking-figure tabular-nums max-md:text-figure-sm',
          highlight ? 'text-success' : 'text-ink',
        )}
      >
        {value}
      </strong>
      {share === null ? null : (
        <span className="col-span-full block h-1 overflow-hidden rounded-pill bg-surface-3" role="presentation">
          <span className="block h-full rounded-[inherit] bg-ink" style={{ inlineSize: `${Math.round(share * 100)}%` }} />
        </span>
      )}
      {meta ? <small className="col-span-full text-sm font-medium text-muted">{meta}</small> : null}
    </article>
  );
}

/*
 * The row of figure cards: as many 210px-or-wider columns as fit, 12px apart; two columns 8px apart under 768px, where
 * an odd last card takes the whole row. Five cards sit five across from 1100px and three across from 768px, four sit
 * two by two from 768px to 1100px: never four and one, or three and one, left alone (owner 2026-11-11). In the desk
 * column it keeps its own height. The cards rise in (`riseInClass`).
 */
const STAT_ROW = cn(
  'grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-3 max-md:grid-cols-2 max-md:gap-2',
  'max-md:[&>:last-child:nth-child(odd)]:col-span-full',
  'xl:has-[>:nth-child(5):last-child]:grid-cols-5 md:max-xl:has-[>:nth-child(5):last-child]:grid-cols-3',
  'md:max-xl:has-[>:nth-child(4):last-child]:grid-cols-2',
  '[.desk_&]:flex-none',
  riseInClass,
);

export function StatRow({ children }: { children: ReactNode }) {
  return <div className={STAT_ROW} data-slot="stat-row" data-testid="stat-row">{children}</div>;
}
