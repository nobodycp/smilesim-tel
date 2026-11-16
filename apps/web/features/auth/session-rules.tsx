'use client';

import { useState } from 'react';
import { layerName } from '../../components/names';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import type { LayerKey, SessionRuleResult, SessionRuleValues } from '../../lib/api-types';
import { usePrefs } from '../../lib/prefs';
import { useApiQuery } from '../../lib/use-api-query';
import { cn } from '../../lib/cn';

// Session rules (spec 2026-11-08-session-rules): sessions allowed and idle time, per layer (settings) and per account
// (the user page's «الجلسات»). An empty choice follows the next level: account → layer → default.

const LAYERS: readonly LayerKey[] = ['branch', 'main_agent', 'agent', 'pos'];
// The server's ranges (apps/api/src/modules/auth/sessions.ts).
const SESSION_COUNT = { min: 1, max: 10 } as const;
const SESSION_MINUTES = { min: 15, max: 43200 } as const;

/** «6 ساعات», «30 minutes», «7 ימים»: the language's own plural, Latin digits. */
export function durationLabel(locale: string, minutes: number) {
  const [value, unit] = minutes % 1440 === 0 ? [minutes / 1440, 'day'] : minutes % 60 === 0 ? [minutes / 60, 'hour'] : [minutes, 'minute'];
  return new Intl.NumberFormat(`${locale}-u-nu-latn`, { style: 'unit', unit, unitDisplay: 'long' }).format(value);
}

/** Hours as a field shows them: whole when whole, else up to two decimals (0.25, 1.5). */
function hoursText(minutes: number | null) {
  if (minutes === null) return '';
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 100) / 100);
}

/**
 * Sessions allowed and idle time as two number fields (owner 2026-11-11), not lists: a count from 1 to 10, and hours —
 * fractions allowed, a quarter hour to 30 days. Empty follows the next level, whose value the field shows as its
 * placeholder. A value out of range is still handed on (the server refuses it) and the field says the range.
 */
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
  const [hours, setHours] = useState(hoursText(values.sessionMinutes));
  const [seenMinutes, setSeenMinutes] = useState(values.sessionMinutes);
  if (values.sessionMinutes !== seenMinutes) {
    setSeenMinutes(values.sessionMinutes);
    if (Math.round(Number(hours) * 60) !== values.sessionMinutes) setHours(hoursText(values.sessionMinutes));
  }
  const count = values.maxSessions;
  const countBad = count !== null && (!Number.isInteger(count) || count < SESSION_COUNT.min || count > SESSION_COUNT.max);
  const minutes = values.sessionMinutes;
  const hoursBad = minutes !== null && (!Number.isFinite(minutes) || minutes < SESSION_MINUTES.min || minutes > SESSION_MINUTES.max);
  // Two labelled fields side by side (owner 2026-11-11): the name above, a sunken field with the inherited value as its
  // placeholder and the range inside it at the end; out of range the frame, the range and a sentence turn red.
  const rangeError = (min: string, max: string) => t.rangeError.replace('{min}', min).replace('{max}', max);
  return (
    <div className={rule.fields}>
      <label className={rule.field}>
        <span className={rule.name}>{t.maxSessionsLabel}</span>
        <span className={ruleBox(countBad)} data-invalid={countBad || undefined}>
          <input
            className={rule.input}
            type="number"
            inputMode="numeric"
            min={SESSION_COUNT.min}
            max={SESSION_COUNT.max}
            step={1}
            value={count ?? ''}
            placeholder={`${fallbackLabel} (${fallback.maxSessions})`}
            aria-invalid={countBad || undefined}
            onChange={(event) => onChange({ ...values, maxSessions: event.target.value === '' ? null : Number(event.target.value) })}
          />
          <small className={ruleRange(countBad)}><bdi dir="ltr">{t.sessionsRange}</bdi></small>
        </span>
        {countBad ? <span className={rule.error} role="alert">{rangeError('1', '10')}</span> : null}
      </label>
      <label className={rule.field}>
        <span className={rule.name}>{t.idleHoursLabel}</span>
        <span className={ruleBox(hoursBad)} data-invalid={hoursBad || undefined}>
          <input
            className={rule.input}
            type="number"
            inputMode="decimal"
            min={0.25}
            max={SESSION_MINUTES.max / 60}
            step={0.25}
            value={hours}
            placeholder={`${fallbackLabel} (${durationLabel(locale, fallback.sessionMinutes)})`}
            aria-invalid={hoursBad || undefined}
            onChange={(event) => {
              const text = event.target.value;
              setHours(text);
              onChange({ ...values, sessionMinutes: text === '' ? null : Math.round(Number(text) * 60) });
            }}
          />
          <small className={ruleRange(hoursBad)}><bdi dir="ltr">{t.hoursRange}</bdi></small>
        </span>
        {hoursBad ? <span className={rule.error} role="alert">{rangeError('0.25', '720')}</span> : null}
      </label>
    </div>
  );
}

/*
 * The two session fields (Tailwind migration T3.2), ported from graphite.css's role dialog block; the same in the
 * role dialog, on the account page and in the layer pane. Two columns 16px apart (one under 641px); each a 4px grid:
 * the name 12px bold muted, then a 34px field on `--rd-surface` (44px under 641px) inside a hairline at 70% of
 * `--rd-field`, its input bare (13px semibold, tabular, the placeholder muted) and the range 12px in `--rd-faint` at
 * the end; focus draws the crimson hairline and an 18% crimson ring. Out of range the hairline, the ring and the range
 * turn red, and a 12px bold red sentence follows. The label keeps its context's look (pane, dialog) for its own text.
 */
const rule = {
  fields: 'grid grid-cols-2 gap-x-4 gap-y-3 max-sm:grid-cols-1',
  field: 'grid min-w-0 content-start gap-1 text-start',
  name: 'text-sm font-bold text-muted',
  input: cn(
    'h-full w-full min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-start text-md font-semibold text-ink tabular-nums shadow-none outline-0',
    'placeholder:font-semibold placeholder:text-muted placeholder:opacity-100',
  ),
  error: 'text-sm font-bold text-danger',
} as const;
const ruleBox = (bad: boolean) =>
  cn(
    'flex h-8.5 items-center gap-2 rounded-sm border bg-surface px-3 focus-within:ring-3 max-sm:h-11',
    bad ? 'border-danger focus-within:ring-danger/18' : 'border-field/70 focus-within:border-accent focus-within:ring-accent/18',
  );
const ruleRange = (bad: boolean) => cn('flex-none text-sm', bad ? 'font-bold text-danger' : 'font-semibold text-faint');

/** Whether both values are empty (follow the next level) or inside the server's ranges: «حفظ» waits for it. */
export function sessionRulesValid(values: SessionRuleValues) {
  const { maxSessions: count, sessionMinutes: minutes } = values;
  const countOk = count === null || (Number.isInteger(count) && count >= SESSION_COUNT.min && count <= SESSION_COUNT.max);
  const minutesOk = minutes === null || (Number.isFinite(minutes) && minutes >= SESSION_MINUTES.min && minutes <= SESSION_MINUTES.max);
  return countOk && minutesOk;
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
    // The pane (`.pane`, `.pane-head`, `.pane-body`) stays legacy classes until Tailwind migration T3.3. One row per
    // layer (settings.css `.session-rules`): the name over its two fields and «حفظ», a hairline under each but the
    // last; stacked under 641px.
    <section className="pane">
      <header className="pane-head"><h2>{t.sessionRulesTitle}</h2></header>
      <div className="pane-body">
        <p className="m-0 text-sm text-muted">{t.sessionRulesHint}</p>
        {view ? (
          <ul className="m-0 grid list-none gap-3 p-0">
            {LAYERS.map((layer) => (
              <li
                key={layer}
                className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-end gap-2 border-b border-line pb-3 last:border-b-0 last:pb-0 max-sm:grid-cols-1"
              >
                <strong className="col-span-full">{layerName(t, layer)}</strong>
                <RuleSelects
                  values={drafts[layer] ?? view.layers[layer]}
                  fallback={view.defaults}
                  fallbackLabel={t.followDefault}
                  onChange={(values) => setDrafts((current) => ({ ...current, [layer]: values }))}
                />
                <Button type="button" disabled={busy !== null || !drafts[layer] || !sessionRulesValid(drafts[layer]!)} onClick={() => save(layer)}>{t.save}</Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
