'use client';

import { useState } from 'react';
import { latinWhen } from '../../components/desk';
import { Fact, Facts } from '../../components/facts';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { api, type ProviderAccount } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';

/**
 * A provider's matching (spec 2026-11-08-overview-and-reports-nav, E), simulated until real providers are connected:
 * its source (API at once, or a statement every N days), when it was last matched, whether that is overdue, and its
 * open differences. A statement provider can run a demo statement match.
 */
export function MatchingPane({ summary, canWrite, run, busy }: {
  summary: ProviderAccount;
  canWrite: boolean;
  run: (work: () => Promise<{ ok: true; data: unknown } | { ok: false; message: string }>, step: { note: string }) => Promise<unknown>;
  busy: boolean;
}) {
  const { t } = usePrefs();
  const [source, setSource] = useState<'api' | 'statement'>(summary.matchSource ?? 'statement');
  const [days, setDays] = useState(String(summary.matchEveryDays ?? 7));
  const dirty = source !== (summary.matchSource ?? 'statement') || Number(days) !== (summary.matchEveryDays ?? 7);
  const daysValue = Number(days);
  const valid = Number.isInteger(daysValue) && daysValue >= 1 && daysValue <= 90;

  return (
    <section className="pane">
      <header className="pane-head">
        <h2>{t.matchSettings}</h2>
        {summary.matchOverdue ? <Badge variant="warning" dot>{t.matchOverdue}</Badge> : null}
      </header>
      <div className="pane-body stack">
        <Facts variant="list">
          <Fact label={t.matchSource}>{summary.matchSource === 'api' ? t.matchSourceApi : t.matchSourceStatement}</Fact>
          <Fact label={t.matchLast}>{summary.matchSource === 'api' ? t.matchSourceApi : summary.lastMatchedAt ? <bdi dir="ltr">{latinWhen(summary.lastMatchedAt)}</bdi> : t.matchNever}</Fact>
          <Fact label={t.matchOpenDifferences} tone={summary.openDifferences ? 'warn' : undefined}><span className="num">{summary.openDifferences ?? 0}</span></Fact>
        </Facts>
        {canWrite ? (
          <div className="field-row">
            <label>
              {t.matchSource}
              <Select value={source} onChange={(event) => setSource(event.target.value as 'api' | 'statement')}>
                <option value="api">{t.matchSourceApi}</option>
                <option value="statement">{t.matchSourceStatement}</option>
              </Select>
            </label>
            {source === 'statement' ? (
              <label>
                {t.matchEveryDays}
                <input className="num" inputMode="numeric" dir="ltr" value={days} onChange={(event) => setDays(event.target.value)} />
              </label>
            ) : null}
            <Button type="button" disabled={busy || !dirty || !valid} onClick={() => void run(() => api.setProviderMatching(summary.code, { matchSource: source, matchEveryDays: valid ? daysValue : 7 }), { note: t.saved })}>
              {t.save}
            </Button>
            {summary.matchSource === 'statement' ? (
              <Button type="button" variant="outline" disabled={busy} onClick={() => void run(() => api.simulateProviderStatement(summary.code), { note: t.matchRunDone })}>
                {t.matchRunStatement}
              </Button>
            ) : null}
          </div>
        ) : null}
        <p className="hint">{t.matchSimulatedHint}</p>
      </div>
    </section>
  );
}
