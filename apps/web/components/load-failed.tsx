'use client';

import { usePrefs } from '../lib/prefs';
import { EmptyState } from './empty-state';
import { Button } from './ui/button';

/**
 * A pane whose load failed. Sits where the table or skeleton would, inside the pane, and offers
 * one retry for that pane alone. `message` is the translated failure the hook holds. It is the empty state in its
 * `danger` tone.
 */
export function LoadFailed({ message, onRetry, busy = false }: { message: string; onRetry?: () => void; busy?: boolean }) {
  const { t } = usePrefs();
  const network = message === t.errors.NETWORK;
  return (
    <EmptyState
      tone="danger"
      icon={network ? 'offline' : 'tasks'}
      role="alert"
      testId="load-failed"
      text={!network && message ? message : undefined}
      textTestId="load-failed-message"
      footer={onRetry ? (
        <Button type="button" onClick={onRetry} disabled={busy}>
          {busy ? t.retrying : t.retry}
        </Button>
      ) : null}
    >
      {network ? t.outageTitle : t.loadFailed}
    </EmptyState>
  );
}
