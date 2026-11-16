'use client';

import { useId, useState, type PointerEvent } from 'react';
import { cn } from '../lib/cn';

/**
 * The trend inside a home period card (owner 2026-11-09): a smooth line over a soft gradient area that draws in, a
 * glowing dot that breathes at the latest point, and the value of the nearest step on hover. SVG, no library; time
 * runs left to right in every language. Motion only under `prefers-reduced-motion: no-preference` (CSS).
 *
 * Look (Tailwind migration T3.3, ADR 0022), ported from graphite.css: a left-to-right box 52px high that sits at the
 * bottom of its card and reaches 4px past its sides (`large`: 200px, flush); inside a home period card
 * (`data-slot="pulse-tile"`) it lies along the card's lower 55%, under the words. The SVG fills it, not clipped, with a
 * crosshair; it is revealed left to right over 1100ms after 120ms. The area is a gradient of the tone (34% to 0),
 * fading in over 700ms after 500ms; the stroke 2 wide in the tone over a 6-wide blurred glow at 18%; the hover cursor a
 * dashed 1-wide `--rd-muted` line; the `large` guides 1-wide `--rd-line`. The dot is 8px round in the tone with a 3px
 * halo at 25% and a 12px glow; it pops in at 1100ms, then breathes (from 1500ms, every 2.4s). The tip sits 4px over
 * the box, centred on the step: 3px / 7px padding, 4px corners on `--rd-surface-3` with a 1px `--rd-line` ring and a
 * soft drop shadow, 11px ink on one line. Tones: `--rd-accent` (default) or `--rd-success`.
 */
const TONE = {
  accent: {
    stop: '[stop-color:var(--rd-accent)]',
    stroke: 'stroke-accent',
    dot: 'bg-accent [box-shadow:0_0_0_3px_--alpha(var(--color-accent)/25%),0_0_12px_var(--rd-accent)]',
  },
  success: {
    stop: '[stop-color:var(--rd-success)]',
    stroke: 'stroke-success',
    dot: 'bg-success [box-shadow:0_0_0_3px_--alpha(var(--color-success)/25%),0_0_12px_var(--rd-success)]',
  },
} as const;

export function TrendLine({ values, labels, format, label, tone = 'accent', size = 'small' }: {
  values: number[];
  labels: string[];
  format: (value: number) => string;
  label: string;
  tone?: 'accent' | 'success';
  /** `large`: the balance chart of the wallet head, with faint guide lines. */
  size?: 'small' | 'large';
}) {
  const id = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  if (values.length < 2) return null;
  const width = size === 'large' ? 600 : 200;
  const height = size === 'large' ? 160 : 48;
  const high = Math.max(...values);
  const low = Math.min(0, ...values);
  const span = high - low || 1;
  const points = values.map((value, index) => [(index / (values.length - 1)) * width, height - 4 - ((value - low) / span) * (height - 10)] as const);
  // A gentle curve through the points (Catmull-Rom as cubic Béziers), flat at both ends.
  let line = `M${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const [x0, y0] = points[Math.max(0, index - 1)];
    const [x1, y1] = points[index];
    const [x2, y2] = points[index + 1];
    const [x3, y3] = points[Math.min(points.length - 1, index + 2)];
    // Control points kept between the two ends of the segment, so the curve never overshoots below the baseline.
    const clamp = (y: number) => Math.min(Math.max(y, Math.min(y1, y2)), Math.max(y1, y2));
    const c1 = [x1 + (x2 - x0) / 6, clamp(y1 + (y2 - y0) / 6)];
    const c2 = [x2 - (x3 - x1) / 6, clamp(y2 - (y3 - y1) / 6)];
    line += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const [lastX, lastY] = points[points.length - 1];
  const shown = hover ?? null;

  function onMove(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    setHover(Math.round(ratio * (values.length - 1)));
  }

  return (
    <div
      className={cn(
        'relative mt-auto [direction:ltr]',
        size === 'large' ? 'mx-0 h-50' : '-mx-1 h-13',
        '[[data-slot=pulse-tile]>&]:absolute [[data-slot=pulse-tile]>&]:inset-x-0 [[data-slot=pulse-tile]>&]:bottom-0 [[data-slot=pulse-tile]>&]:z-0 [[data-slot=pulse-tile]>&]:m-0 [[data-slot=pulse-tile]>&]:h-[55%]',
      )}
      data-slot="trend-line"
      data-testid="trend-line"
    >
      <svg
        className="block size-full cursor-crosshair overflow-visible motion-safe:animate-[trend-draw_1100ms_cubic-bezier(0.23,1,0.32,1)_120ms_both]"
        viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`trend-fill-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className={cn(TONE[tone].stop, '[stop-opacity:0.34]')} />
            <stop offset="100%" className={cn(TONE[tone].stop, '[stop-opacity:0]')} />
          </linearGradient>
        </defs>
        {size === 'large' ? [0.25, 0.5, 0.75].map((at) => <line key={at} className="stroke-line stroke-1" x1={0} x2={width} y1={height * at} y2={height * at} vectorEffect="non-scaling-stroke" />) : null}
        <path className="stroke-none motion-safe:animate-[trend-fade_700ms_ease-out_500ms_forwards] motion-safe:opacity-0" d={area} fill={`url(#trend-fill-${id})`} />
        <path className={cn('fill-none stroke-6 opacity-18 blur-[3px] [stroke-linecap:round]', TONE[tone].stroke)} d={line} vectorEffect="non-scaling-stroke" />
        <path className={cn('fill-none stroke-2 [stroke-linecap:round] [stroke-linejoin:round]', TONE[tone].stroke)} d={line} vectorEffect="non-scaling-stroke" />
        {shown !== null ? <line className="stroke-muted stroke-1 [stroke-dasharray:2_3]" x1={points[shown][0]} x2={points[shown][0]} y1={0} y2={height} vectorEffect="non-scaling-stroke" /> : null}
      </svg>
      <span
        className={cn(
          'pointer-events-none absolute -ms-1 -mt-1 size-2 rounded-pill',
          'motion-safe:animate-[trend-pop_400ms_ease-out_1100ms_both,trend-breathe_2.4s_ease-in-out_1500ms_infinite]',
          TONE[tone].dot,
        )}
        style={{ left: `${(lastX / width) * 100}%`, top: `${(lastY / height) * 100}%` }} aria-hidden="true" />
      {shown !== null ? (
        <span
          className="pointer-events-none absolute bottom-[calc(100%+4px)] z-2 -translate-x-1/2 rounded-xs bg-surface-3 px-1.75 py-0.75 text-xs whitespace-nowrap text-ink shadow-[0_6px_16px] shadow-scrim-strong/50 ring-1 ring-line"
          style={{ left: `${(points[shown][0] / width) * 100}%` }} aria-hidden="true">
          <bdi dir="ltr">{labels[shown]}</bdi> · <bdi dir="ltr">{format(values[shown])}</bdi>
        </span>
      ) : null}
    </div>
  );
}
