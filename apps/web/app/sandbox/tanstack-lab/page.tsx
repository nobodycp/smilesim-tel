'use client';

import { Desk } from '../../../components/desk';
import { usePrefs } from '../../../lib/prefs';
import { useRequireLayer } from '../../../lib/use-require-layer';
import { CurrentPane } from './current-pane';
import { TanstackPane } from './tanstack-pane';

const BRANCH = ['branch'];

export default function TanstackLabPage() {
  const { locale } = usePrefs();
  const allowed = useRequireLayer(BRANCH);

  const banner =
    locale === 'en'
      ? 'Internal evaluation tool, not a feature. Compares the current data layer with TanStack Query + Table on the same data. Delete this route after the comparison is reviewed.'
      : locale === 'he'
        ? 'כלי הערכה פנימי, לא תכונה. משווה את שכבת הנתונים הנוכחית מול TanStack Query + Table על אותם נתונים. יש למחוק נתיב זה אחרי סקירת ההשוואה.'
        : 'أداة تقييم داخلية، مو ميزة. تقارن طبقة البيانات الحالية مع TanStack Query + Table على نفس البيانات. تُحذف هذه الصفحة بعد مراجعة المقارنة.';

  return (
    <Desk title={allowed ? 'TanStack lab' : ''} lede="" error="" note="">
      <p className="hint" role="note">
        {banner}
      </p>
      {allowed && (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))' }}>
          <CurrentPane />
          <TanstackPane />
        </div>
      )}
    </Desk>
  );
}
