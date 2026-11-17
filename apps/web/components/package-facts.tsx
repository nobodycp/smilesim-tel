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

/*
 * The look (ADR 0022): a grid 4px apart; the line 12px
 * `--rd-muted` 600; the extra text 12px ink with no margin, its line breaks kept. `data-slot="package-facts"` is its
 * handle.
 */
export function PackageFacts({ facts, withDetails = true }: { facts: Facts; withDetails?: boolean }) {
  const line = useFactLine()(facts);
  const details = withDetails ? facts.details?.trim() : '';
  if (!line && !details) return null;
  return (
    <div className="grid gap-1" data-slot="package-facts">
      {line ? <span className="text-sm font-semibold text-muted">{line}</span> : null}
      {details ? <p className="m-0 text-sm whitespace-pre-line text-ink" data-testid="package-facts-details">{details}</p> : null}
    </div>
  );
}

/**
 * The same details as tiles, for the step where a point of sale has picked the package (spec
 * 2026-11-16-package-page, P.4): one tile per stated fact — internet, minutes, messages, the package's duration — and
 * the extra text under them. A fact that is not stated has no tile. The tile is the stat tile of the package page:
 * `--rd-surface-2`, the card radius, a muted 12px bold name over a bold tabular value.
 */
export function PackageFactTiles({ facts }: { facts: Facts }) {
  const { t } = usePrefs();
  const amount = (value: number | null | undefined) => (value === null || value === undefined ? null : value === -1 ? t.unlimited : String(value));
  const months = facts.months ?? 0;
  const tiles = [
    { name: t.dataGbLabel, value: amount(facts.dataGb) },
    { name: t.minutesLabel, value: amount(facts.minutes) },
    { name: t.smsLabel, value: amount(facts.smsCount) },
    { name: t.packagePeriod, value: months < 1 ? null : months === 1 ? t.monthOne : months === 2 ? t.monthTwo : `${months} ${t.months}` },
  ].filter((tile): tile is { name: string; value: string } => tile.value !== null);
  const details = facts.details?.trim();
  if (tiles.length === 0 && !details) return null;
  return (
    <div className="grid min-w-0 gap-2" data-slot="package-fact-tiles">
      {tiles.length > 0 ? (
        <div className="grid grid-cols-4 gap-2 max-md:grid-cols-2">
          {tiles.map((tile) => (
            <div key={tile.name} className="grid min-w-0 content-start gap-1 rounded-card bg-surface-2 p-3">
              <span className="text-sm font-bold text-muted">{tile.name}</span>
              <strong className="text-xl leading-tight font-bold text-ink tabular-nums">{tile.value}</strong>
            </div>
          ))}
        </div>
      ) : null}
      {details ? <p className="m-0 text-sm whitespace-pre-line text-ink" data-testid="package-facts-details">{details}</p> : null}
    </div>
  );
}
