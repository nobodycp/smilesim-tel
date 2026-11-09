'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
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
 */
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
    <div className={active ? 'donut pointing' : 'donut'}>
      <svg className="donut-ring" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`${label}: ${slices.map((slice) => `${slice.label} ${slice.value}`).join('، ')}`}>
        <circle className="donut-track" cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} strokeWidth={STROKE} />
        {sum > 0 && slices.filter((slice) => slice.value > 0).map((slice, index, drawn) => {
          const full = (slice.value / sum) * CIRCUMFERENCE;
          const length = drawn.length > 1 ? Math.max(full - GAP, 1) : full;
          const ring = (
            <circle
              key={slice.key}
              className={slice.key === active ? 'donut-slice on' : 'donut-slice'}
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
            <text className="donut-total share" x="50%" y="46%" textAnchor="middle" dominantBaseline="central">{`${shareOf(shown)}%`}</text>
            <text className="donut-caption" x="50%" y="62%" textAnchor="middle" dominantBaseline="central">{shown.label}</text>
          </>
        ) : (
          <text className="donut-total" x="50%" y="50%" textAnchor="middle" dominantBaseline="central">{total}</text>
        )}
      </svg>
      <ul className="donut-legend">
        {slices.map((slice) => {
          const change = slice.change ?? 0;
          const body = (
            <>
              <span className="donut-dot" style={{ background: `var(${slice.tone})` }} aria-hidden="true" />
              <span className="donut-label">{slice.label}</span>
              {change !== 0 ? (
                <span
                  className={change > 0 ? 'donut-change up' : 'donut-change down'}
                  aria-label={(change > 0 ? t.changeMore : t.changeFewer).replace('{n}', String(Math.abs(change)))}
                >
                  {change > 0 ? <ArrowUp size={12} strokeWidth={2.4} aria-hidden="true" /> : <ArrowDown size={12} strokeWidth={2.4} aria-hidden="true" />}
                  <bdi className="num" dir="ltr">{Math.abs(change)}</bdi>
                </span>
              ) : <span className="donut-change none" aria-hidden="true" />}
              <span className="donut-value num">{slice.value}</span>
            </>
          );
          return (
            <li key={slice.key} className={slice.key === active ? 'on' : undefined} {...point(slice.key)}>
              {slice.href ? <Link href={slice.href}>{body}</Link> : <span tabIndex={0}>{body}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
