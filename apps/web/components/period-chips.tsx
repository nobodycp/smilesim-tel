'use client';

import { usePrefs } from '../lib/prefs';

function iso(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function range(days: number) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (days - 1));
  return { from: iso(start), to: iso(end) };
}

export function PeriodChips({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const { t } = usePrefs();
  const monthStart = new Date();
  monthStart.setDate(1);
  const choices = [
    { id: 'all', label: t.periodAll, from: '', to: '' },
    { id: '7', label: t.period7, ...range(7) },
    { id: '30', label: t.period30, ...range(30) },
    { id: '90', label: t.period90, ...range(90) },
    { id: 'month', label: t.periodMonth, from: iso(monthStart), to: iso(new Date()) },
  ];
  return (
    <div className="period-chips" role="group" aria-label={t.period}>
      {choices.map((choice) => {
        const on = choice.from === from && choice.to === to;
        return (
          <button key={choice.id} type="button" aria-pressed={on} className={on ? 'is-on' : undefined} onClick={() => onChange(choice.from, choice.to)}>
            {choice.label}
          </button>
        );
      })}
    </div>
  );
}
