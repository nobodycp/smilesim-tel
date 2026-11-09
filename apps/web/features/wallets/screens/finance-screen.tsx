'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';
import { BalanceChart } from '../../../components/balance-chart';
import { Stat, StatRow } from '../../../components/stat';
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
  const summary = useApiQuery(sharedKeys.financeSummary, () => api.financeSummary());
  const list = usePaged<FinanceRow>(`${kind}|${layer}|${q}|${from}|${to}|${scope}`, async (cursor) =>
    pick(await api.officeFinance({ kind, layer, q, from, to, scope, cursor }), (data) => ({ rows: data.entries, next: data.nextCursor, total: data.total })),
  );

  const columns: Column<FinanceRow>[] = [
    { key: 'when', header: t.when, cell: 'when', render: (row) => <bdi dir="ltr">{latinWhen(row.at)}</bdi> },
    { key: 'layer', header: t.layer, render: (row) => (row.layer ? layerName(t, row.layer) : '—') },
    { key: 'account', header: t.accountName, render: (row) => <AccountName login={row.loginName} /> },
    { key: 'actor', header: t.actedBy, render: (row) => <AccountName login={row.actorLogin} /> },
    {
      key: 'kind',
      header: t.kind,
      render: (row) => (
        <span className="kind-cell">
          {movementName(t, row.kind)}
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
    // Money in reads «+», money out «−»: the sign carries the direction, the colour only repeats it.
    { key: 'amount', header: t.amount, num: true, render: (row) => <Money value={row.amount} signed /> },
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
    { key: 'before', header: t.balanceBefore, num: true, render: (row) => <Money value={row.balanceBefore} /> },
    { key: 'after', header: t.balanceAfter, num: true, render: (row) => <Money value={row.balanceAfter} /> },
    { key: 'number', header: t.number, render: (row) => (row.msisdn ? <bdi dir="ltr">{row.msisdn}</bdi> : '—') },
    { key: 'company', header: t.company, render: (row) => row.companyName || '—' },
    { key: 'package', header: t.packageName, render: (row) => row.packageName || '—' },
    { key: 'price', header: t.packagePrice, num: true, render: (row) => (row.packagePrice == null ? '—' : <Money value={row.packagePrice} />) },
    { key: 'note', header: t.note, render: (row) => row.note || '—' },
  ];

  return (
    <Desk title={t.navFinance} lede="" error="" note="">
      {summary.data?.series ? <WalletHead summary={summary.data} /> : null}
      <div className="section-head">
        <h2>{t.statement}</h2>
        <a className={buttonClass({ variant: 'outline', size: 'sm' })} href={api.financeExportHref({ kind, layer, q, from, to, scope })} download>
          <Download size={15} aria-hidden="true" />
          {t.exportCsv}
        </a>
      </div>
      <FilterBar onClear={() => { setKind(''); setLayer(''); setQ(''); setFrom(''); setTo(''); setScope(''); }} clearLabel={t.clearFilters}>
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
        <label>
          {t.financeSearch}
          <input value={q} onChange={(event) => setQ(event.target.value)} />
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
        <PagedTable list={list} columns={columns} rowKey={(row) => row.id} empty={t.noMovements} keepHead skeleton={{ rows: 6, columns: 13 }} />
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

/** The signed-in account's wallet: four cards, the balance over 30 days, and what moved in that time. */
export function WalletHead({ summary }: { summary: FinanceSummary }) {
  const { t } = usePrefs();
  const used = Math.max(0, -summary.balance);
  const first = summary.series[0]?.balance ?? summary.balance;
  const change = summary.balance - first;
  return (
    <>
      <StatRow>
        <Stat icon="wallet" label={t.balance} value={<Money value={summary.balance} />} />
        <Stat
          icon="lock"
          label={t.ceiling}
          value={summary.unlimited ? t.noCeiling : <Money value={summary.ceiling} />}
          progress={summary.unlimited || summary.ceiling <= 0 ? null : used / summary.ceiling}
        />
        <Stat icon="reports" label={t.usedCeiling} value={summary.unlimited ? '—' : <Money value={used} />} />
        <Stat icon="tasks" tone={summary.held ? 'warning' : 'muted'} label={t.held} value={<Money value={summary.held ?? 0} />} meta={t.heldHint} />
        <Stat icon="plans" label={t.availableToSell} value={summary.unlimited ? t.noCeiling : <Money value={summary.balance + summary.ceiling - (summary.held ?? 0)} />} highlight />
      </StatRow>
      <div className="wallet-board">
        <section className="pane wallet-chart">
          <header className="pane-head">
            <div>
              <h2>{t.balanceOverTime}</h2>
              <p className="hint">{t.balanceOverTimeHint}</p>
            </div>
            <p className="wallet-chart-figures">
              <span>{t.nowLabel} <Money value={summary.balance} /></span>
              <span>{t.change30} <Money value={change} signed /></span>
            </p>
          </header>
          <div className="pane-body">
            <BalanceChart series={summary.series} label={t.balanceOverTime} />
          </div>
        </section>
        <div className="wallet-figures">
          <Stat icon="reports" tone="success" label={t.myProfit30} value={<Money value={summary.profit ?? 0} signed />} meta={t.salesCount.replace('{n}', String(summary.sales ?? 0))} />
          <Stat icon="wallet" label={t.moneyIn30} value={<Money value={summary.moneyIn} />} />
          <Stat icon="wallet" label={t.moneyOut30} value={<Money value={summary.moneyOut} />} />
          <Stat icon="reports" label={t.entries30} value={summary.count} />
        </div>
      </div>
    </>
  );
}
