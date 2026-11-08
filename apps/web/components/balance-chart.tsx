'use client';

const WIDTH = 640;
const HEIGHT = 200;
const PAD = { top: 12, right: 12, bottom: 26, left: 56 };

/**
 * End-of-day balances as a line over a soft area, drawn in SVG (no chart library). Time runs left to right in every
 * language, like the dates under it. Four quiet grid lines carry the amounts; every fifth day is named.
 */
export function BalanceChart({ series, label }: { series: { day: string; balance: number }[]; label: string }) {
  if (series.length === 0) return null;
  const values = series.map((point) => point.balance);
  let low = Math.min(0, ...values);
  let high = Math.max(...values);
  if (high === low) high = low + 10_000;
  const span = high - low;
  if (low < 0) low -= span * 0.05;
  high += span * 0.08;
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (index: number) => PAD.left + (series.length === 1 ? innerW : (index / (series.length - 1)) * innerW);
  const y = (value: number) => PAD.top + (1 - (value - low) / (high - low)) * innerH;
  const line = series.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(point.balance).toFixed(1)}`).join(' ');
  const area = `${line} L${x(series.length - 1).toFixed(1)},${(PAD.top + innerH).toFixed(1)} L${x(0).toFixed(1)},${(PAD.top + innerH).toFixed(1)} Z`;
  const ticks = [0, 1, 2, 3].map((step) => low + ((high - low) * step) / 3);
  const last = series[series.length - 1];
  const dayName = (day: string) => `${Number(day.slice(8, 10))}/${Number(day.slice(5, 7))}`;

  return (
    <div className="balance-chart-box" dir="ltr">
    <svg className="balance-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label}>
      {ticks.map((tick) => (
        <g key={tick}>
          <line className="grid" x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} />
          <text className="axis" x={PAD.left - 8} y={y(tick) + 4} textAnchor="end">{Math.round(tick / 100).toLocaleString('en-US')}</text>
        </g>
      ))}
      <path className="area" d={area} />
      <path className="line" d={line} />
      <circle className="dot" cx={x(series.length - 1)} cy={y(last.balance)} r={4} />
      {series.map((point, index) => (index % 5 === (series.length - 1) % 5 ? (
        <text key={point.day} className="axis" x={x(index)} y={HEIGHT - 6} textAnchor="middle">{dayName(point.day)}</text>
      ) : null))}
    </svg>
    </div>
  );
}
