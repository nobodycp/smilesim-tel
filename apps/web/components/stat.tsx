import type { ReactNode } from 'react';
import { Icon, type IconName } from './icon';

type StatTone = 'success' | 'warning' | 'danger' | 'muted';

export function Stat({
  icon,
  tone,
  value,
  label,
  meta,
}: {
  icon: IconName;
  tone: StatTone;
  value: ReactNode;
  label: string;
  meta?: ReactNode;
}) {
  return (
    <article className={`stat ${tone}`}>
      <span className="stat-icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {meta ? <small className="stat-meta">{meta}</small> : null}
    </article>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return <div className="stat-row">{children}</div>;
}
