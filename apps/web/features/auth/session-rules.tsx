'use client';

import { useState } from 'react';
import { layerName } from '../../components/names';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { api } from '../../lib/api';
import type { LayerKey, SessionRuleResult, SessionRuleValues } from '../../lib/api-types';
import { usePrefs } from '../../lib/prefs';
import { useApiQuery } from '../../lib/use-api-query';

// Session rules (spec 2026-11-08-session-rules): sessions allowed and idle time, per layer (settings) and per account
// (the user page's «الجلسات»). An empty choice follows the next level: account → layer → default.

const LAYERS: readonly LayerKey[] = ['branch', 'main_agent', 'agent', 'pos'];
const COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const MINUTES = [15, 30, 60, 120, 240, 360, 480, 720, 1440, 4320, 10080, 43200];

/** «6 ساعات», «30 minutes», «7 ימים»: the language's own plural, Latin digits. */
export function durationLabel(locale: string, minutes: number) {
  const [value, unit] = minutes % 1440 === 0 ? [minutes / 1440, 'day'] : minutes % 60 === 0 ? [minutes / 60, 'hour'] : [minutes, 'minute'];
  return new Intl.NumberFormat(`${locale}-u-nu-latn`, { style: 'unit', unit, unitDisplay: 'long' }).format(value);
}

export function RuleSelects({
  values,
  fallback,
  fallbackLabel,
  onChange,
}: {
  values: SessionRuleValues;
  fallback: SessionRuleResult;
  fallbackLabel: string;
  onChange: (values: SessionRuleValues) => void;
}) {
  const { t, locale } = usePrefs();
  const number = (value: string) => (value === '' ? null : Number(value));
  return (
    <>
      <label>
        {t.maxSessionsLabel}
        <Select value={values.maxSessions ?? ''} onChange={(event) => onChange({ ...values, maxSessions: number(event.target.value) })}>
          <option value="">{`${fallbackLabel} (${fallback.maxSessions})`}</option>
          {COUNTS.map((count) => <option key={count} value={count}>{count}</option>)}
        </Select>
      </label>
      <label>
        {t.idleLabel}
        <Select value={values.sessionMinutes ?? ''} onChange={(event) => onChange({ ...values, sessionMinutes: number(event.target.value) })}>
          <option value="">{`${fallbackLabel} (${durationLabel(locale, fallback.sessionMinutes)})`}</option>
          {MINUTES.map((minutes) => <option key={minutes} value={minutes}>{durationLabel(locale, minutes)}</option>)}
        </Select>
      </label>
    </>
  );
}

/** Settings, branch owner only: one row per layer. */
export function LayerSessionRulesPane({ setError, setNote }: { setError: (text: string) => void; setNote: (text: string) => void }) {
  const { t, apiText } = usePrefs();
  const rules = useApiQuery(['auth', 'session-rules'], () => api.sessionRules());
  const [drafts, setDrafts] = useState<Partial<Record<LayerKey, SessionRuleValues>>>({});
  const [busy, setBusy] = useState<LayerKey | null>(null);
  const view = rules.data;

  async function save(layer: LayerKey) {
    if (!view) return;
    setError('');
    setNote('');
    setBusy(layer);
    const result = await api.setLayerSessionRules(layer, drafts[layer] ?? view.layers[layer]);
    setBusy(null);
    if (!result.ok) return setError(apiText(result));
    setDrafts((current) => ({ ...current, [layer]: undefined }));
    setNote(t.sessionRulesSaved);
    await rules.reload();
  }

  return (
    <section className="pane">
      <header className="pane-head"><h2>{t.sessionRulesTitle}</h2></header>
      <div className="pane-body">
        <p className="hint">{t.sessionRulesHint}</p>
        {view ? (
          <ul className="session-rules">
            {LAYERS.map((layer) => (
              <li key={layer}>
                <strong>{layerName(t, layer)}</strong>
                <RuleSelects
                  values={drafts[layer] ?? view.layers[layer]}
                  fallback={view.defaults}
                  fallbackLabel={t.followDefault}
                  onChange={(values) => setDrafts((current) => ({ ...current, [layer]: values }))}
                />
                <Button type="button" disabled={busy !== null || !drafts[layer]} onClick={() => save(layer)}>{t.save}</Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
