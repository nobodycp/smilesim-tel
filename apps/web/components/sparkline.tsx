/**
 * A small trend line under a figure (Graphite figure tiles, spec 2026-11-09-graphite-identity). SVG, no library; time
 * runs left to right in every language, like the balance chart. The line draws in once (`pathLength`, CSS), the area
 * under it is a soft tint of the same colour. Decoration beside the figure, so it is hidden from assistive tech; the
 * caller's `label` names the trend for them.
 */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const width = 120;
  const height = 36;
  const high = Math.max(...values);
  const low = Math.min(0, ...values);
  const span = high - low || 1;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - 3 - ((value - low) / span) * (height - 6);
    return [x, y] as const;
  });
  const line = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <path className="sparkline-area" d={area} />
      <path className="sparkline-line" d={line} pathLength={1} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
