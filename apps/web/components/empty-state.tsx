import type { ReactNode } from 'react';
import { Icon, type IconName } from './icon';

export function EmptyState({
  children,
  text,
  icon = 'tasks',
}: {
  children: ReactNode;
  text?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="empty empty-state">
      <span className="empty-icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <p className="empty-title">{children}</p>
      {text ? <p className="empty-text">{text}</p> : null}
    </div>
  );
}
