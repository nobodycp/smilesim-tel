'use client';

import { type ReactNode } from 'react';
import { type Outcome } from '../lib/api';
import { formatShekel } from '../lib/money';
import { useOffice } from '../lib/office-session';
import { usePageTitle } from '../lib/page-title';
import { usePrefs } from '../lib/prefs';
import { PageAlert } from './dialog';
import { PageSkeleton } from './loading';

export { actionName, applyNote, layerName, lineStatus, taskStatus } from './names';

export function Desk({
  title,
  lede,
  action,
  error,
  note,
  children,
}: {
  title: ReactNode;
  lede: string;
  action?: ReactNode;
  error: string;
  note: string;
  children: ReactNode;
}) {
  const { ready } = useOffice();
  usePageTitle(typeof title === 'string' ? title : '');
  // The page's own loads already started; the content waits for the session so a guarded page
  // never flashes before the account is known.
  if (!ready) return <PageSkeleton />;

  return (
    <div className="desk">
      <header className="page-head">
        <h1>{title}</h1>
        {action}
        {lede ? <p className="lede">{lede}</p> : null}
      </header>
      <PageAlert error={error} note={note}>
        {children}
      </PageAlert>
    </div>
  );
}

// `muted` renders a reference figure (a default beside a custom value); `signed` colours a
// difference and prefixes the plus.
export function Money({ value, muted, signed }: { value: number; muted?: boolean; signed?: boolean }) {
  const tone = value < 0 ? ' neg' : signed && value > 0 ? ' pos' : '';
  return (
    <span className={`money${tone}${muted ? ' muted' : ''}`} dir="ltr">
      {signed && value > 0 ? '+' : ''}{formatShekel(value)}
    </span>
  );
}

export function OutcomePick({
  value,
  onChange,
}: {
  value: Outcome;
  onChange: (value: Outcome) => void;
}) {
  const { t } = usePrefs();
  return (
    <div className="stack" style={{ gap: 4 }}>
      <span className="hint">{t.outcome}</span>
      <div className="seg" role="group" aria-label={t.outcome}>
        <button type="button" aria-pressed={value === 'success'} onClick={() => onChange('success')}>
          {t.success}
        </button>
        <button type="button" aria-pressed={value === 'fail'} onClick={() => onChange('fail')}>
          {t.failure}
        </button>
      </div>
    </div>
  );
}

export function latinWhen(value: string, precise = false): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, '0');
  const clock = precise
    ? `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    : `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock}`;
}

export function whole(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}
