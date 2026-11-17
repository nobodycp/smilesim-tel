'use client';

import { useState } from 'react';
import { Money, Pane } from '../../components/desk';
import { pointerGlowClass } from '../../components/stat';
import { TrendLine } from '../../components/trend-line';
import { SegmentedToggle, SegmentedToggleItem } from '../../components/ui/segmented';
import { api, type FinanceSummary } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatShekel } from '../../lib/money';
import { usePrefs } from '../../lib/prefs';
import { sharedKeys } from '../../lib/query';
import { useApiQuery } from '../../lib/use-api-query';

/** The windows the wallet head offers (owner 2026-11-09). */
const WINDOWS = [7, 30, 90] as const;
type Window = (typeof WINDOWS)[number];

/*
 * The wallet band:
 * - the band: a grid 12px apart, two columns; from 1100px the lead and three cards (1.6fr, then three equal); under
 *   640px the lead and the fourth card take the whole row. In the desk column it keeps its own height. Its cards rise
 *   in (8px, 420ms), the second to the fourth 40ms after the one before, when motion is allowed;
 * - a card (`data-slot="figure-tile"`): a column 6px apart, at least 112px high, 14px / 16px padding (12px all round
 *   and no minimum under 640px), 8px corners on `--rd-surface` with a 1px inset `--rd-line` edge and the tag's cut
 *   corner (`--rd-cut`) at the top inline end; a soft `--rd-glow` light under the pointer (the shell sets `--mx` /
 *   `--my`) and, when motion is allowed, a 2px lift;
 * - the lead card: its edge `--rd-accent` at 35% over `--rd-line`, a 2px `--rd-accent` thread along its top up to the
 *   cut, its figure 1.9rem (1.6rem under 640px);
 * - the name 12px `--rd-muted` 500; the figure 1.45rem bold, 1.25 line height, -0.01em, tabular (1.2rem under 640px),
 *   money in `--rd-success` and money out `--rd-danger` (the shekel figure inside too); the caption at the card's
 *   foot, 12px `--rd-muted`, 1.6 line height;
 * - the ceiling's twenty ticks, 3px apart, 4px under the figure: 6px high, 1px corners, `--rd-surface-2` with a 1px
 *   inset `--rd-line` edge, the used ones `--rd-accent` with no edge.
 */
const BAND = cn(
  'grid grid-cols-2 gap-3 xl:grid-cols-[1.6fr_repeat(3,minmax(0,1fr))] max-sm:[&>:nth-child(4)]:col-span-full [.desk_&]:flex-none',
  'motion-safe:*:animate-rise',
  'motion-safe:[&>:nth-child(2)]:[animation-delay:40ms] motion-safe:[&>:nth-child(3)]:[animation-delay:80ms] motion-safe:[&>:nth-child(4)]:[animation-delay:120ms]',
);
const FIGURE_TILE = cn(
  'relative isolate flex min-h-28 min-w-0 flex-col gap-1.5 overflow-hidden rounded-card bg-surface px-4 py-3.5 inset-ring inset-ring-line max-sm:min-h-0 max-sm:p-3',
  '[clip-path:polygon(0_0,calc(100%_-_var(--rd-cut))_0,100%_var(--rd-cut),100%_100%,0_100%)]',
  'rtl:[clip-path:polygon(var(--rd-cut)_0,100%_0,100%_100%,0_100%,0_var(--rd-cut))]',
  pointerGlowClass,
);
const LEAD_TILE = cn(
  FIGURE_TILE,
  'inset-ring-accent/35 shadow-edge max-sm:col-span-full',
  "before:absolute before:start-0 before:end-(--rd-cut) before:top-0 before:h-0.5 before:bg-accent before:content-['']",
);
const TILE_LABEL = 'text-sm font-medium text-muted';
const TILE_VALUE = 'text-figure leading-1-25 font-bold tracking-figure tabular-nums max-sm:text-figure-sm';
const LEAD_VALUE = 'text-figure-lead leading-1-25 font-bold tracking-figure tabular-nums max-sm:text-figure-lead-sm';
const TILE_META = 'mt-auto block text-sm leading-1-6 text-muted';

/**
 * The signed-in account's wallet, as in the approved Graphite design, on «المحفظة» (it left «المالية», a statement
 * only, by spec 2026-11-09-admin-review, 1): four tiles —
 * the balance (the lead: what is held and what is left to sell, the ceiling as twenty ticks), money in and money out
 * over the window, and the number of movements with how many were made by hand —, then the balance over time with the
 * window's switch (7 days, 30 days, 3 months), which the tiles follow. The chart card is `Pane`; its head (one wrapping
 * row 12px apart, at least 52px high, 14px / 18px padding, a 1px `--rd-line` rule under it), title (14px bold ink),
 * hint (12px `--rd-muted`, 2px under the title) and body (a grid 12px apart, 14px / 18px / 18px padding, scrolling in
 * the desk) are set here.
 */
export function WalletHead() {
  const { t } = usePrefs();
  const [days, setDays] = useState<Window>(30);
  const query = useApiQuery(days === 30 ? sharedKeys.financeSummary : [...sharedKeys.financeSummary, days], () => api.financeSummary(days));
  // The last answer stays on screen while another window loads, so the tiles never blink.
  const [last, setLast] = useState<FinanceSummary | null>(null);
  if (query.data && query.data !== last) setLast(query.data);
  const summary = query.data ?? last;
  if (!summary?.series) return null;
  const used = Math.max(0, -summary.balance) + (summary.held ?? 0);
  const available = summary.balance + summary.ceiling - (summary.held ?? 0);
  const limited = !summary.unlimited && summary.ceiling > 0;
  const share = limited ? Math.min(1, used / summary.ceiling) : 0;
  const first = summary.series[0]?.balance ?? summary.balance;
  const change = summary.balance - first;
  const windowName = days === 7 ? t.period7 : days === 30 ? t.period30 : t.period3m;
  return (
    <>
      <section className={BAND} aria-label={t.balance} data-testid="wallet-band">
        <div className={LEAD_TILE} data-slot="figure-tile" data-testid="balance-tile">
          <span className={TILE_LABEL}>{t.yourBalance}</span>
          <div className={LEAD_VALUE}><Money value={summary.balance} /></div>
          {limited ? (
            <div className="mt-1 flex gap-0.75" role="img" aria-label={`${t.usedCeiling}: ${Math.round(share * 100)}%`}>
              {Array.from({ length: 20 }, (_, index) => <i key={index} className={cn('h-1.5 flex-1 rounded-4xs', index < Math.round(share * 20) ? 'bg-accent' : 'bg-surface-2 inset-ring inset-ring-line')} />)}
            </div>
          ) : null}
          <div className={TILE_META}>
            {t.heldForTasks}: <Money value={summary.held ?? 0} /> · {t.availableToSell}: {summary.unlimited ? t.noCeiling : <Money value={available} />}
            {limited ? <> · {t.ceiling}: <Money value={summary.ceiling} /></> : null}
          </div>
        </div>
        <div className={FIGURE_TILE} data-slot="figure-tile">
          <span className={TILE_LABEL}>{t.moneyInWindow.replace('{window}', windowName)}</span>
          <div className={cn(TILE_VALUE, 'text-success [&_[data-slot=money]]:text-success')}><Money value={summary.moneyIn} /></div>
          <div className={TILE_META}>{t.moneyInMeta}</div>
        </div>
        <div className={FIGURE_TILE} data-slot="figure-tile">
          <span className={TILE_LABEL}>{t.moneyOutWindow.replace('{window}', windowName)}</span>
          <div className={cn(TILE_VALUE, 'text-danger [&_[data-slot=money]]:text-danger')}><Money value={-summary.moneyOut} /></div>
          <div className={TILE_META}>{t.moneyOutMeta}</div>
        </div>
        <div className={FIGURE_TILE} data-slot="figure-tile">
          <span className={TILE_LABEL}>{t.movementsCount}</span>
          <div className={TILE_VALUE}>{summary.count}</div>
          <div className={TILE_META}>{t.manualMeta.replace('{n}', String(summary.manual ?? 0))}</div>
        </div>
      </section>
      <Pane data-testid="wallet-chart">
        <header className="flex min-h-13 flex-wrap items-center justify-between gap-3 border-b border-line bg-transparent px-4.5 py-3.5">
          <div>
            <h2 className="m-0 inline-flex items-center gap-2 text-base font-bold text-ink">{t.balanceOverTime}</h2>
            <p className="mx-0 mt-0.5 mb-0 text-sm text-muted">{t.lastDaysMeta.replace('{n}', String(days))} · {t.nowLabel} <Money value={summary.balance} /> · <Money value={change} signed /></p>
          </div>
          {/* The chart card's window switch: the period switch's look (`SegmentedToggle`, components/ui/segmented.tsx). */}
          <SegmentedToggle aria-label={t.period}>
            {WINDOWS.map((value) => (
              <SegmentedToggleItem key={value} pressed={days === value} onClick={() => setDays(value)}>
                {value === 7 ? t.period7 : value === 30 ? t.period30 : t.period3m}
              </SegmentedToggleItem>
            ))}
          </SegmentedToggle>
        </header>
        <div className="grid content-start gap-3 px-4.5 pt-3.5 pb-4.5 *:min-w-0 [.desk_&]:min-h-0 [.desk_&]:overflow-auto">
          <TrendLine
            size="large"
            values={summary.series.map((point) => point.balance)}
            labels={summary.series.map((point) => point.day.slice(5))}
            format={(value) => formatShekel(value)}
            label={t.balanceOverTime}
          />
        </div>
      </Pane>
    </>
  );
}
