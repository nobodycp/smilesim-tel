'use client';

import { usePrefs } from '../lib/prefs';
import { Spinner } from './loading';

// The "load more" row under a cursor-paged list. Render it only while the server has another page.
export function LoadMore({ shown, loading, onMore }: { shown: number; loading: boolean; onMore: () => void }) {
  const { t } = usePrefs();
  return (
    <div className="pane-body">
      <div className="pane-tools">
        <button type="button" className="secondary" disabled={loading} onClick={onMore}>{t.loadMore}</button>
        {loading && <Spinner size={18} />}
        <span className="hint">{t.shownCount.replace('{n}', String(shown))}</span>
      </div>
    </div>
  );
}
