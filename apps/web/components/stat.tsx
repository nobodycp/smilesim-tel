import type { ReactNode } from 'react';
import { Icon, type IconName } from './icon';

type StatTone = 'success' | 'warning' | 'danger' | 'muted';

/**
 * A figure card (spec 2026-11-08-inner-pages-refresh, §3): the label at the start, a small icon at the end, the value
 * large under them, then an optional caption. `tone` colours the icon. `highlight` tints the card: the one figure that
 * matters most on the screen. `progress` (0–1) draws a thin bar under the value, for a share such as the ceiling used.
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
  icon: IconName;
  tone?: StatTone;
  value: ReactNode;
  label: string;
  meta?: ReactNode;
  highlight?: boolean;
  progress?: number | null;
}) {
  const share = progress == null ? null : Math.min(1, Math.max(0, progress));
  return (
    <article className={highlight ? `stat ${tone} highlight` : `stat ${tone}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <strong className="stat-value">{value}</strong>
      {share === null ? null : (
        <span className="stat-bar" role="presentation">
          <span style={{ inlineSize: `${Math.round(share * 100)}%` }} />
        </span>
      )}
      {meta ? <small className="stat-meta">{meta}</small> : null}
    </article>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return <div className="stat-row">{children}</div>;
}
