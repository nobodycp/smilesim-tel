'use client';

import Link from 'next/link';

export type DonutSlice = { key: string; label: string; value: number; tone: string; href?: string };

const SIZE = 168;
const STROKE = 22;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * A donut drawn in SVG (no chart library) with its legend beside it: each slice is a ring segment in the slice's
 * `tone` (a `--rd-*` colour token), and the legend repeats every label with its count, so colour never carries the
 * meaning alone. The total sits in the middle. A slice with an `href` links from the legend.
 */
export function Donut({ slices, total, label }: { slices: DonutSlice[]; total: string; label: string }) {
  const sum = slices.reduce((acc, slice) => acc + slice.value, 0);
  let offset = 0;
  return (
    <div className="donut">
      <svg className="donut-ring" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`${label}: ${slices.map((slice) => `${slice.label} ${slice.value}`).join('، ')}`}>
        <circle className="donut-track" cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} strokeWidth={STROKE} />
        {sum > 0 && slices.filter((slice) => slice.value > 0).map((slice) => {
          const length = (slice.value / sum) * CIRCUMFERENCE;
          const ring = (
            <circle
              key={slice.key}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              style={{ stroke: `var(${slice.tone})` }}
              strokeWidth={STROKE}
              strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            />
          );
          offset += length;
          return ring;
        })}
        <text className="donut-total" x="50%" y="50%" textAnchor="middle" dominantBaseline="central">{total}</text>
      </svg>
      <ul className="donut-legend">
        {slices.map((slice) => {
          const share = sum > 0 ? Math.round((slice.value / sum) * 100) : 0;
          const body = (
            <>
              <span className="donut-dot" style={{ background: `var(${slice.tone})` }} aria-hidden="true" />
              <span className="donut-label">{slice.label}</span>
              <span className="donut-value num">{slice.value}</span>
              <span className="donut-share num">{share}%</span>
            </>
          );
          return <li key={slice.key}>{slice.href ? <Link href={slice.href}>{body}</Link> : <span>{body}</span>}</li>;
        })}
      </ul>
    </div>
  );
}
