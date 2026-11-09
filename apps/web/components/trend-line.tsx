'use client';

import { useId, useState, type PointerEvent } from 'react';

/**
 * The trend inside a home period card (owner 2026-11-09): a smooth line over a soft gradient area that draws in, a
 * glowing dot that breathes at the latest point, and the value of the nearest step on hover. SVG, no library; time
 * runs left to right in every language. Motion only under `prefers-reduced-motion: no-preference` (CSS).
 */
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
    <div className={`trend-line ${tone} ${size}`}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`trend-fill-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="trend-stop-top" />
            <stop offset="100%" className="trend-stop-bottom" />
          </linearGradient>
        </defs>
        {size === 'large' ? [0.25, 0.5, 0.75].map((at) => <line key={at} className="trend-guide" x1={0} x2={width} y1={height * at} y2={height * at} vectorEffect="non-scaling-stroke" />) : null}
        <path className="trend-area" d={area} fill={`url(#trend-fill-${id})`} />
        <path className="trend-glow" d={line} vectorEffect="non-scaling-stroke" />
        <path className="trend-stroke" d={line} vectorEffect="non-scaling-stroke" />
        {shown !== null ? <line className="trend-cursor" x1={points[shown][0]} x2={points[shown][0]} y1={0} y2={height} vectorEffect="non-scaling-stroke" /> : null}
      </svg>
      <span className="trend-dot" style={{ left: `${(lastX / width) * 100}%`, top: `${(lastY / height) * 100}%` }} aria-hidden="true" />
      {shown !== null ? (
        <span className="trend-tip" style={{ left: `${(points[shown][0] / width) * 100}%` }} aria-hidden="true">
          <bdi dir="ltr">{labels[shown]}</bdi> · <bdi dir="ltr">{format(values[shown])}</bdi>
        </span>
      ) : null}
    </div>
  );
}
