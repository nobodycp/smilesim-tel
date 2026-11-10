'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Icon } from '../components/icon';
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
        <div className="empty empty-state load-failed" role="alert">
          <span className="empty-icon" aria-hidden="true">
            <Icon name="tasks" />
          </span>
          <p className="empty-title">{t.pageErrorTitle}</p>
          <p className="empty-text">{t.pageErrorText}</p>
          <div className="empty-actions">
            <Button type="button" onClick={() => retry()}>{t.retry}</Button>
            <Link className="back-link" href="/">{t.goHome}</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
