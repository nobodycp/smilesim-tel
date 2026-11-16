'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { EmptyState } from '../components/empty-state';
import { usePrefs } from '../lib/prefs';
import { Button } from '../components/ui/button';

/**
 * A page that threw while rendering. The shell stays (this boundary sits inside the root layout); the canvas shows
 * the shared empty state with a retry, which re-renders the page, and the way home.
 */
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  const { t } = usePrefs();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="desk">
      <section className="pane">
        <EmptyState
          tone="danger"
          role="alert"
          testId={null}
          text={t.pageErrorText}
          actions={(
            <>
              <Button type="button" onClick={() => retry()}>{t.retry}</Button>
              <Link className="back-link" data-testid="back-link" href="/">{t.goHome}</Link>
            </>
          )}
        >
          {t.pageErrorTitle}
        </EmptyState>
      </section>
    </div>
  );
}
