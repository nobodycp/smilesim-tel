'use client';

import { useState } from 'react';
import { Money } from '../../components/desk';
import { TrendLine } from '../../components/trend-line';
import { api, type FinanceSummary } from '../../lib/api';
import { formatShekel } from '../../lib/money';
import { usePrefs } from '../../lib/prefs';
import { sharedKeys } from '../../lib/query';
import { useApiQuery } from '../../lib/use-api-query';

/** The windows the wallet head offers (owner 2026-11-09). */
const WINDOWS = [7, 30, 90] as const;
type Window = (typeof WINDOWS)[number];

/**
 * The signed-in account's wallet, as in the approved Graphite design, on «المحفظة» (it left «المالية», a statement
 * only, by spec 2026-11-09-admin-review, 1): four tiles —
 * the balance (the lead: what is held and what is left to sell, the ceiling as twenty ticks), money in and money out
 * over the window, and the number of movements with how many were made by hand —, then the balance over time with the
 * window's switch (7 days, 30 days, 3 months), which the tiles follow.
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
      <section className="figure-band wallet-band" aria-label={t.balance}>
        <div className="figure-tile lead">
          <span className="figure-tile-label">{t.yourBalance}</span>
          <div className="figure-tile-value"><Money value={summary.balance} /></div>
          {limited ? (
            <div className="hero-bar" role="img" aria-label={`${t.usedCeiling}: ${Math.round(share * 100)}%`}>
              {Array.from({ length: 20 }, (_, index) => <i key={index} className={index < Math.round(share * 20) ? 'on' : undefined} />)}
            </div>
          ) : null}
          <div className="figure-tile-meta">
            {t.heldForTasks}: <Money value={summary.held ?? 0} /> · {t.availableToSell}: {summary.unlimited ? t.noCeiling : <Money value={available} />}
            {limited ? <> · {t.ceiling}: <Money value={summary.ceiling} /></> : null}
          </div>
        </div>
        <div className="figure-tile">
          <span className="figure-tile-label">{t.moneyInWindow.replace('{window}', windowName)}</span>
          <div className="figure-tile-value tone-success"><Money value={summary.moneyIn} /></div>
          <div className="figure-tile-meta">{t.moneyInMeta}</div>
        </div>
        <div className="figure-tile">
          <span className="figure-tile-label">{t.moneyOutWindow.replace('{window}', windowName)}</span>
          <div className="figure-tile-value tone-danger"><Money value={-summary.moneyOut} /></div>
          <div className="figure-tile-meta">{t.moneyOutMeta}</div>
        </div>
        <div className="figure-tile">
          <span className="figure-tile-label">{t.movementsCount}</span>
          <div className="figure-tile-value"><span className="num">{summary.count}</span></div>
          <div className="figure-tile-meta">{t.manualMeta.replace('{n}', String(summary.manual ?? 0))}</div>
        </div>
      </section>
      <section className="pane wallet-chart">
        <header className="pane-head">
          <div>
            <h2>{t.balanceOverTime}</h2>
            <p className="hint">{t.lastDaysMeta.replace('{n}', String(days))} · {t.nowLabel} <Money value={summary.balance} /> · <Money value={change} signed /></p>
          </div>
          <div className="period" role="group" aria-label={t.period}>
            {WINDOWS.map((value) => (
              <button key={value} type="button" className={days === value ? 'on' : undefined} aria-pressed={days === value} onClick={() => setDays(value)}>
                {value === 7 ? t.period7 : value === 30 ? t.period30 : t.period3m}
              </button>
            ))}
          </div>
        </header>
        <div className="pane-body">
          <TrendLine
            size="large"
            values={summary.series.map((point) => point.balance)}
            labels={summary.series.map((point) => point.day.slice(5))}
            format={(value) => `${formatShekel(value)} ₪`}
            label={t.balanceOverTime}
          />
        </div>
      </section>
    </>
  );
}
