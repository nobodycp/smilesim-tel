'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { cn } from '../lib/cn';
import { usePrefs } from '../lib/prefs';

export type DonutSlice = {
  key: string;
  label: string;
  value: number;
  tone: string;
  href?: string;
  /** How much the slice moved over the period picked; null or undefined when unknown, nothing shown for 0. */
  change?: number | null;
};

const SIZE = 168;
const STROKE = 22;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** The clear gap between two slices, in the ring's units (none when one slice fills the ring). */
const GAP = 2.5;

/**
 * A donut drawn in SVG (no chart library) with its legend beside it: each slice is a ring segment in the slice's
 * `tone` (a `--rd-*` colour token), and the legend repeats every label with its count, so colour never carries the
 * meaning alone. The total sits in the middle; pointing at a slice — on the ring or in the legend, or focusing its
 * link — puts that slice's share and name there instead (spec 2026-11-09-admin-review, 6.4). Beside each count, its
 * change over the period sits before it: a green ↑ with the number for more, a red ↓ for fewer, and the count closes
 * the line (spec 2026-11-09-admin-review, 8.2). The ring draws in; the slice pointed
 * at thickens and the others dim (no motion with reduced motion).
 *
 * Look (ADR 0022): the ring and the legend in one
 * wrapping row, centred on the cross axis, 16px apart; the ring 168px, butt ends, its track `--rd-surface-2`; a slice
 * is a pointer target that thickens to 28px when pointed at while the others dim to 35% (180ms), and draws in over
 * 700ms, each 70ms after the one before; the total 27px ink 800 tabular (22.5px for a share), the caption 11px
 * `--rd-muted` 600, both fading in over 220ms, no stroke (the global `svg` rule strokes every shape). The legend takes
 * the rest of the row (at least 180px), a column 4px apart; each line a grid of the dot, the name, the change and the
 * count, 8px apart, 6px / 8px padding, 6px corners, ink, on `--rd-surface-2` under the pointer (a link) or when
 * pointed at; the others dim to 55%; a link is at least 40px high at 640px and under. The dot 10px round; the change
 * 11px bold at least 3.5ch wide at the end (`--rd-success` up, `--rd-danger` down), 2px between its arrow and number;
 * the count bold at the end, at least 2ch. In the home page's narrow column (`data-slot="home-side"`) the ring is 112px, the row
 * does not wrap and its gap is 12px, the legend has no minimum and its lines 3px top and bottom; in a card under 341px
 * the row wraps, centred, and the legend takes a line of its own.
 */
const FADE = 'motion-safe:animate-[donut-fade_220ms_ease-out]';
const TOTAL = cn(FADE, 'fill-ink font-bold tabular-nums');
const LINE = cn(
  'grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 rounded-sm px-2 py-1.5 text-ink',
  '[[data-slot=home-side]_&]:py-0.75',
);
const CHANGE = 'inline-flex min-w-[3.5ch] items-center justify-end gap-0.5 text-xs font-bold';
export function Donut({ slices, total, label }: { slices: DonutSlice[]; total: string; label: string }) {
  const { t } = usePrefs();
  const [active, setActive] = useState<string | null>(null);
  const sum = slices.reduce((acc, slice) => acc + slice.value, 0);
  const shareOf = (slice: DonutSlice) => (sum > 0 ? Math.round((slice.value / sum) * 100) : 0);
  const shown = slices.find((slice) => slice.key === active) ?? null;
  let offset = 0;
  const point = (key: string) => ({
    onMouseEnter: () => setActive(key),
    onMouseLeave: () => setActive((current) => (current === key ? null : current)),
    onFocus: () => setActive(key),
    onBlur: () => setActive((current) => (current === key ? null : current)),
  });
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-4',
        '[[data-slot=home-side]_&]:flex-nowrap [[data-slot=home-side]_&]:gap-3 [[data-slot=home-side]_&]:@max-[341px]:flex-wrap [[data-slot=home-side]_&]:@max-[341px]:justify-center',
      )}
      data-slot="donut"
    >
      <svg className={cn('size-42 flex-none [stroke-linecap:butt] [&_text]:stroke-none', '[[data-slot=home-side]_&]:size-28')} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`${label}: ${slices.map((slice) => `${slice.label} ${slice.value}`).join('، ')}`}>
        <circle className="fill-none stroke-surface-2" cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} strokeWidth={STROKE} />
        {sum > 0 && slices.filter((slice) => slice.value > 0).map((slice, index, drawn) => {
          const full = (slice.value / sum) * CIRCUMFERENCE;
          const length = drawn.length > 1 ? Math.max(full - GAP, 1) : full;
          const ring = (
            <circle
              key={slice.key}
              className={cn(
                'cursor-pointer transition-[stroke-width,opacity] duration-base ease-out motion-safe:animate-[donut-draw_700ms_var(--rd-ease-out)_both]',
                slice.key === active ? 'stroke-28' : active ? 'opacity-35' : '',
              )}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              style={{ stroke: `var(${slice.tone})`, ['--slice' as string]: `${length}`, ['--gap' as string]: `${CIRCUMFERENCE - length}`, animationDelay: `${index * 70}ms` }}
              strokeWidth={STROKE}
              strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
              {...point(slice.key)}
            />
          );
          offset += full;
          return ring;
        })}
        {shown ? (
          <>
            <text className={cn(TOTAL, 'text-[calc(var(--rd-text-2xl)*1.25)]')} data-testid="donut-total" x="50%" y="46%" textAnchor="middle" dominantBaseline="central">{`${shareOf(shown)}%`}</text>
            <text className={cn(FADE, 'fill-muted text-xs font-semibold')} data-testid="donut-caption" x="50%" y="62%" textAnchor="middle" dominantBaseline="central">{shown.label}</text>
          </>
        ) : (
          <text className={cn(TOTAL, 'text-[calc(var(--rd-text-2xl)*1.5)]')} data-testid="donut-total" x="50%" y="50%" textAnchor="middle" dominantBaseline="central">{total}</text>
        )}
      </svg>
      <ul
        className={cn(
          'm-0 grid min-w-45 flex-1 list-none gap-1 p-0',
          '[[data-slot=home-side]_&]:min-w-0 [[data-slot=home-side]_&]:@max-[341px]:basis-full',
        )}
        data-testid="donut-legend"
      >
        {slices.map((slice) => {
          const change = slice.change ?? 0;
          const body = (
            <>
              <span className="size-2.5 rounded-pill" style={{ background: `var(${slice.tone})` }} aria-hidden="true" />
              <span>{slice.label}</span>
              {change !== 0 ? (
                <span
                  className={cn(CHANGE, change > 0 ? 'text-success' : 'text-danger')}
                  data-testid={change > 0 ? 'donut-change-up' : 'donut-change-down'}
                  aria-label={(change > 0 ? t.changeMore : t.changeFewer).replace('{n}', String(Math.abs(change)))}
                >
                  {change > 0 ? <ArrowUp size={12} strokeWidth={2.4} aria-hidden="true" /> : <ArrowDown size={12} strokeWidth={2.4} aria-hidden="true" />}
                  <bdi dir="ltr">{Math.abs(change)}</bdi>
                </span>
              ) : <span className={CHANGE} aria-hidden="true" />}
              <span className="min-w-[2ch] text-end font-bold" data-testid="donut-value">{slice.value}</span>
            </>
          );
          return (
            <li
              key={slice.key}
              className={cn('transition-opacity duration-base ease-out', active && slice.key !== active ? 'opacity-55' : '')}
              {...point(slice.key)}
            >
              {slice.href ? (
                <Link className={cn(LINE, 'hover:bg-surface-2 max-sm:min-h-10', slice.key === active && 'bg-surface-2')} href={slice.href}>{body}</Link>
              ) : (
                <span className={cn(LINE, slice.key === active && 'bg-surface-2')} tabIndex={0}>{body}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
