'use client';

import { Receipt, Search } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { TrendLine } from '../../../components/trend-line';
import { formatShekel } from '../../../lib/money';
import { buttonClass } from '../../../components/ui/button';
import { sharedKeys } from '../../../lib/query';
import { useApiQuery } from '../../../lib/use-api-query';
import { AccountName } from '../../../components/account-name';
import { PagedTable, type Column } from '../../../components/data-table';
import { Desk, Money, actionName, latinWhen, layerName } from '../../../components/desk';
import { FilterBar } from '../../../components/filter-bar';
import { api, type FinanceRow, type FinanceSummary } from '../../../lib/api';
import type { Copy } from '../../../lib/copy';
import { usePrefs } from '../../../lib/prefs';
import { pick } from '../../../lib/fetched';
import { usePaged } from '../../../lib/use-paged';
import { Badge } from '../../../components/ui/badge';
import { Select } from '../../../components/ui/select';
import { Dialog } from '../../../components/dialog';
import { useOffice } from '../../../lib/office-session';
import { CsvLink } from '../../reports/report-kit';
import { Fact, Facts } from '../../../components/facts';

const KINDS = [
  'fund', 'self_fund', 'deduct', 'deduct_in', 'hold', 'release',
  'activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch', 'rename', 'sim',
] as const;

const LAYERS = ['branch', 'main_agent', 'agent', 'pos'] as const;

export function movementName(t: Copy, kind: string): string {
  if (kind === 'fund') return t.supplyBalance;
  if (kind === 'deduct') return t.moveDeduct;
  if (kind === 'deduct_in') return t.moveDeductIn;
  if (kind === 'hold') return t.moveHold;
  if (kind === 'release') return t.moveRelease;
  if (kind === 'self_fund') return t.topUpBalance;
  return actionName(t, kind);
}

/** The reason tag's colour: a sale is green, money held amber, money given back red, funding violet, the rest muted. */
export function reasonTone(kind: string): string {
  if (['activate', 'charge', 'extend', 'reactivate', 'esim'].includes(kind)) return 'r-leaf';
  if (kind === 'hold') return 'r-amber';
  if (['disconnect', 'deduct', 'deduct_in'].includes(kind)) return 'r-alarm';
  if (['fund', 'self_fund'].includes(kind)) return 'r-plum';
  return 'r-mute';
}

function reasonName(t: Copy, reason: string): string {
  if (reason === 'return') return t.reasonReturn;
  if (reason === 'correction') return t.reasonCorrection;
  if (reason === 'settlement') return t.reasonSettlement;
  return t.reasonDeposit;
}

export function FinanceScreen() {
  const { t } = usePrefs();
  const [kind, setKind] = useState('');
  const [layer, setLayer] = useState('');
  // «كشف الحساب» on the user page opens this list searched by that account (`?q=`).
  const [q, setQ] = useState(() => (typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('q') ?? ''));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // Every operation by default (owner 2026-11-09); «الحركات المالية فقط» keeps the money movements.
  const [scope, setScope] = useState('');
  const [chainOf, setChainOf] = useState<FinanceRow | null>(null);
  const { me } = useOffice();
  const list = usePaged<FinanceRow>(`${kind}|${layer}|${q}|${from}|${to}|${scope}`, async (cursor) =>
    pick(await api.officeFinance({ kind, layer, q, from, to, scope, cursor }), (data) => ({ rows: data.entries, next: data.nextCursor, total: data.total })),
  );

  // The design's ledger: the time, the reason as a coloured tag, what it was about, the amount, my margin, the balance
  // after. The account, its layer, who did it, the number and the package sit together in «التفاصيل».
  const columns: Column<FinanceRow>[] = [
    { key: 'when', header: t.when, cell: 'when', render: (row) => <bdi dir="ltr">{latinWhen(row.at)}</bdi> },
    {
      key: 'kind',
      header: t.reasonColumn,
      render: (row) => (
        <span className="kind-cell">
          <span className={`reason ${reasonTone(row.kind)}`}>{movementName(t, row.kind)}</span>
          {row.reason && row.reason !== 'deposit' ? <Badge variant="muted">{reasonName(t, row.reason)}</Badge> : null}
          {row.held ? <Badge variant="warning" dot>{t.held} <Money value={Math.abs(row.held)} /></Badge> : null}
          {/* An eSIM sale pays the package price plus this fee in one entry; the tag explains the amount. */}
          {row.esimPrice != null && row.kind !== 'esim' && (
            <Badge variant="muted" dot title={t.esimSaleTagTitle}>
              {t.esimSaleTag}
              <Money value={row.esimPrice} />
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: 'detail',
      header: t.detailsColumn,
      cell: 'wrap',
      render: (row) => (
        <span className="ledger-detail">
          <span>
            {[row.msisdn ? <bdi key="n" dir="ltr">{row.msisdn}</bdi> : null, row.packageName || null, row.companyName || null, row.note || null]
              .filter(Boolean)
              .reduce<ReactNode[]>((all, part, index) => (index ? [...all, ' · ', part] : [part]), [])}
            {!row.msisdn && !row.packageName && !row.note ? '—' : null}
          </span>
          <span className="sub">
            <AccountName login={row.loginName} />
            {row.layer ? <> · {layerName(t, row.layer)}</> : null}
            {row.actorLogin && row.actorLogin !== row.loginName ? <> · {t.actedBy}: <AccountName login={row.actorLogin} /></> : null}
          </span>
        </span>
      ),
    },
    // Money in reads «+», money out «−»: the sign carries the direction, the colour only repeats it.
    { key: 'amount', header: t.amount, num: true, render: (row) => (row.amount === 0 ? <span className="muted">—</span> : <Money value={row.amount} signed />) },
    {
      key: 'margin',
      header: t.myMargin,
      num: true,
      render: (row) => {
        if (row.margin == null) return '—';
        if (!row.shares) return <Money value={row.margin} signed />;
        return (
          <button type="button" className="link-btn" onClick={() => setChainOf(row)} title={t.sharesOpen} aria-label={`${t.sharesOpen}: ${row.msisdn}`}>
            <Money value={row.margin} signed />
          </button>
        );
      },
    },
    { key: 'after', header: t.balanceAfterShort, num: true, render: (row) => <Money value={row.balanceAfter} /> },
  ];

  return (
    <Desk
      title={t.navFinance}
      lede={t.financeLede}
      action={(
        <div className="page-actions">
          <CsvLink href={api.financeExportHref({ kind, layer, q, from, to, scope })} />
          {me && me.layer !== 'pos' ? <Link className={buttonClass()} href="/users"><Receipt size={16} aria-hidden="true" />{t.fundAccount}</Link> : null}
        </div>
      )}
      error=""
      note=""
    >
      <WalletHead />
      <div className="section-head"><h2>{t.movementsTitle}</h2></div>
      <FilterBar loose onClear={() => { setKind(''); setLayer(''); setQ(''); setFrom(''); setTo(''); setScope(''); }} clearLabel={t.clearFilters}>
        <label>
          {t.financeScope}
          <Select value={scope} onChange={(event) => setScope(event.target.value)}>
            <option value="">{t.financeScopeAll}</option>
            <option value="money">{t.financeScopeMoney}</option>
          </Select>
        </label>
        <label>
          {t.kind}
          <Select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="">{t.allRows}</option>
            {KINDS.map((value) => (
              <option key={value} value={value}>{movementName(t, value)}</option>
            ))}
          </Select>
        </label>
        <label>
          {t.layer}
          <Select value={layer} onChange={(event) => setLayer(event.target.value)}>
            <option value="">{t.allRows}</option>
            {LAYERS.map((value) => (
              <option key={value} value={value}>{layerName(t, value)}</option>
            ))}
          </Select>
        </label>
        <label className="filter-search">
          <Search size={16} strokeWidth={1.9} aria-hidden="true" />
          <span className="sr-only">{t.financeSearch}</span>
          <input value={q} placeholder={t.financeSearch} onChange={(event) => setQ(event.target.value)} />
        </label>
        <label>
          {t.from}
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          {t.to}
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
      </FilterBar>
      <section className="pane">
        <PagedTable list={list} columns={columns} rowKey={(row) => row.id} empty={t.noMovements} keepHead skeleton={{ rows: 6, columns: 6 }} />
      </section>
      <Dialog open={chainOf !== null} title={t.sharesTitle} lede={t.sharesHint} closeLabel={t.closeMenu} size="confirm" onClose={() => setChainOf(null)}>
        {chainOf?.shares ? (
          <Facts variant="list">
            {chainOf.shares.map((share) => (
              <Fact key={share.loginName} label={<>{layerName(t, share.layer)} · <AccountName login={share.loginName} /></>}>
                <Money value={share.margin} signed />
              </Fact>
            ))}
          </Facts>
        ) : null}
      </Dialog>
    </Desk>
  );
}

/** The windows the wallet head offers (owner 2026-11-09). */
const WINDOWS = [7, 30, 90] as const;
type Window = (typeof WINDOWS)[number];

/**
 * The signed-in account's wallet, as in the approved Graphite design, for the finance and wallet pages: four tiles —
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
