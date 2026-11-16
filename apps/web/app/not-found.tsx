'use client';

import Link from 'next/link';
import { EmptyState } from '../components/empty-state';
import { usePrefs } from '../lib/prefs';
import { Button } from '../components/ui/button';

/** Any address the app does not serve, and any `notFound()`: the shared empty state and the way home. */
export default function NotFound() {
  const { t } = usePrefs();
  return (
    <div className="desk">
      <section className="pane">
        <EmptyState
          role="status"
          testId={null}
          text={t.notFoundText}
          actions={<Button asChild><Link href="/">{t.goHome}</Link></Button>}
        >
          {t.notFoundTitle}
        </EmptyState>
      </section>
    </div>
  );
}
