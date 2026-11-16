'use client';

import { useState } from 'react';
import { Pane, latinWhen } from '../../components/desk';
import { Fact, Facts } from '../../components/facts';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectItem } from '../../components/ui/select';
import { api, type ProviderAccount } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';

/*
 * The look (Tailwind migration T4.8, ADR 0022), ported from desk/pane.css, responsive.css and graphite.css in their
 * cascade order:
 * - the pane: its head a row at least 52px high, 14px / 18px padding, the title at the start and the overdue badge at
 *   the end 8px apart, a 1px `--rd-line` rule under it; the title 14px bold ink; its body a grid 12px apart, 14px /
 *   18px / 18px padding, that scrolls inside the pane in the desk, its children never wider than it;
 * - the settings row: a wrapping row 8px apart at the reading start, its items on the bottom line; each field grows
 *   from 16rem up to 22rem; under 768px a column whose fields take the whole width and whose buttons stay at the
 *   reading start;
 * - the captions are pane labels, the days field a pane field (34px, `--rd-surface`, 13px);
 * - the hint 12px `--rd-muted`, no margin.
 */
const PANE_HEAD = 'flex min-h-13 items-center justify-between gap-2 border-b border-line bg-transparent px-4.5 py-3.5';
const PANE_TITLE = 'm-0 inline-flex items-center gap-2 text-base font-bold text-ink';
const PANE_BODY = 'grid min-h-0 min-w-0 max-w-full content-start gap-3 overflow-auto px-4.5 pt-3.5 pb-4.5 *:min-w-0';
const FIELD_ROW = 'flex flex-wrap items-end justify-start gap-2 max-md:flex-col max-md:items-stretch max-md:[&>button]:self-start';
const FIELD = 'min-w-0 max-w-[22rem] flex-[1_1_16rem] max-md:w-full max-md:max-w-none max-md:flex-none';
const HINT = 'm-0 text-sm text-muted';

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
    <Pane>
      <header className={PANE_HEAD}>
        <h2 className={PANE_TITLE}>{t.matchSettings}</h2>
        {summary.matchOverdue ? <Badge variant="warning" dot>{t.matchOverdue}</Badge> : null}
      </header>
      <div className={PANE_BODY}>
        <Facts variant="list">
          <Fact label={t.matchSource}>{summary.matchSource === 'api' ? t.matchSourceApi : t.matchSourceStatement}</Fact>
          <Fact label={t.matchLast}>{summary.matchSource === 'api' ? t.matchSourceApi : summary.lastMatchedAt ? <bdi dir="ltr">{latinWhen(summary.lastMatchedAt)}</bdi> : t.matchNever}</Fact>
          <Fact label={t.matchOpenDifferences} tone={summary.openDifferences ? 'warn' : undefined}>{summary.openDifferences ?? 0}</Fact>
        </Facts>
        {canWrite ? (
          <div className={FIELD_ROW}>
            <Label tone="pane" className={FIELD}>
              {t.matchSource}
              <Select place="pane" value={source} onValueChange={(next) => setSource(next as 'api' | 'statement')}>
                <SelectItem value="api">{t.matchSourceApi}</SelectItem>
                <SelectItem value="statement">{t.matchSourceStatement}</SelectItem>
              </Select>
            </Label>
            {source === 'statement' ? (
              <Label tone="pane" className={FIELD}>
                {t.matchEveryDays}
                <Input surface="surface" className="text-md" inputMode="numeric" dir="ltr" value={days} onChange={(event) => setDays(event.target.value)} />
              </Label>
            ) : null}
            <Button type="button" disabled={busy || !dirty || !valid} onClick={() => void run(() => api.setProviderMatching(summary.code, { matchSource: source, matchEveryDays: valid ? daysValue : 7 }), { note: t.saved })}>
              {t.save}
            </Button>
            {summary.matchSource === 'statement' ? (
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void run(() => api.simulateProviderStatement(summary.code), { note: t.matchRunDone })}>
                {t.matchRunStatement}
              </Button>
            ) : null}
          </div>
        ) : null}
        <p className={HINT}>{t.matchSimulatedHint}</p>
      </div>
    </Pane>
  );
}
