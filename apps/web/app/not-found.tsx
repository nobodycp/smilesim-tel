'use client';

import Link from 'next/link';
import { Icon } from '../components/icon';
import { usePrefs } from '../lib/prefs';
import { Button } from '../components/ui/button';

/** Any address the app does not serve, and any `notFound()`: the shared empty state and the way home. */
export default function NotFound() {
  const { t } = usePrefs();
  return (
    <div className="desk">
      <section className="pane">
        <div className="empty empty-state" role="status">
          <span className="empty-icon" aria-hidden="true">
            <Icon name="tasks" />
          </span>
          <p className="empty-title">{t.notFoundTitle}</p>
          <p className="empty-text">{t.notFoundText}</p>
          <div className="empty-actions">
            <Button asChild><Link href="/">{t.goHome}</Link></Button>
          </div>
        </div>
      </section>
    </div>
  );
}
