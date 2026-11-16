'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { DeskColumn, Pane } from '../components/desk';
import { EmptyState } from '../components/empty-state';
import { usePrefs } from '../lib/prefs';
import { Button } from '../components/ui/button';

/**
 * A page that threw while rendering. The shell stays (this boundary sits inside the root layout); the canvas shows
 * the shared empty state with a retry, which re-renders the page, and the way home.
 *
 * The way home is the legacy back link (desk/frame.css, Tailwind migration T3.3): 32px high (44px at 720px and under),
 * 10px sides, a 1px `--rd-line` edge with 6px corners on `--rd-surface` and the small shadow, 13px `--rd-ink-2` 600;
 * under the pointer `--rd-surface-2` and ink.
 */
const BACK_LINK =
  'inline-flex h-8 w-fit items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 py-0 text-md font-semibold text-ink-2 no-underline shadow-sm hover:bg-surface-2 hover:text-ink max-[721px]:h-11 [&_svg]:size-4 [&_svg]:flex-none';
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  const { t } = usePrefs();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <DeskColumn>
      <Pane>
        <EmptyState
          tone="danger"
          role="alert"
          testId={null}
          text={t.pageErrorText}
          actions={(
            <>
              <Button type="button" onClick={() => retry()}>{t.retry}</Button>
              <Link className={BACK_LINK} data-testid="back-link" href="/">{t.goHome}</Link>
            </>
          )}
        >
          {t.pageErrorTitle}
        </EmptyState>
      </Pane>
    </DeskColumn>
  );
}
