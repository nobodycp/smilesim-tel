'use client';

import { usePrefs } from '../lib/prefs';
import { Icon } from './icon';

/**
 * A pane whose load failed. Sits where the table or skeleton would, inside the pane, and offers
 * one retry for that pane alone. `message` is the translated failure the hook holds.
 */
export function LoadFailed({ message, onRetry, busy = false }: { message: string; onRetry?: () => void; busy?: boolean }) {
  const { t } = usePrefs();
  const network = message === t.errors.NETWORK;
  return (
    <div className="empty empty-state load-failed" role="alert">
      <span className="empty-icon" aria-hidden="true">
        <Icon name={network ? 'offline' : 'tasks'} />
      </span>
      <p className="empty-title">{network ? t.outageTitle : t.loadFailed}</p>
      {!network && message ? <p className="empty-text">{message}</p> : null}
      {onRetry ? (
        <button type="button" className="btn" onClick={onRetry} disabled={busy}>
          {busy ? t.retrying : t.retry}
        </button>
      ) : null}
    </div>
  );
}
