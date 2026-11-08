'use client';

import { usePrefs } from '../lib/prefs';

// A package's details (spec 2026-11-08-branch-packages-and-details): GB, minutes, messages and months on one line,
// and the extra text under them. null = not stated (left out), -1 = unlimited.

type Facts = { dataGb: number | null; minutes?: number | null; smsCount?: number | null; months?: number; details?: string };

export function useFactLine() {
  const { t } = usePrefs();
  return (facts: Facts) => {
    const parts: string[] = [];
    const amount = (value: number | null | undefined, unlimited: string, counted: string) => {
      if (value === null || value === undefined) return;
      parts.push(value === -1 ? unlimited : counted.replace('{n}', String(value)));
    };
    amount(facts.dataGb, t.factGbUnlimited, t.factGb);
    amount(facts.minutes, t.factMinutesUnlimited, t.factMinutes);
    amount(facts.smsCount, t.factSmsUnlimited, t.factSms);
    if (facts.months && facts.months > 1) parts.push(`${facts.months} ${t.months}`);
    return parts.join(' · ');
  };
}

export function PackageFacts({ facts, withDetails = true }: { facts: Facts; withDetails?: boolean }) {
  const line = useFactLine()(facts);
  const details = withDetails ? facts.details?.trim() : '';
  if (!line && !details) return null;
  return (
    <div className="package-facts">
      {line ? <span className="package-facts-line">{line}</span> : null}
      {details ? <p className="package-facts-details">{details}</p> : null}
    </div>
  );
}
