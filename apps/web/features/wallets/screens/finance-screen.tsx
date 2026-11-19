'use client';

import { DateField } from '../../../components/date-field';
import { Receipt, Search } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Button } from '../../../components/ui/button';
import { AccountName } from '../../../components/account-name';
import { PagedTable, type Column } from '../../../components/data-table';
import { Desk, Money, Pane, actionName, latinWhen, layerName } from '../../../components/desk';
import { FilterBar } from '../../../components/filter-bar';
import { api, type FinanceRow } from '../../../lib/api';
import type { Copy } from '../../../lib/copy';
import { usePrefs } from '../../../lib/prefs';
import { pick } from '../../../lib/fetched';
import { pageRows, usePaged } from '../../../lib/use-paged';
import { Badge } from '../../../components/ui/badge';
import { Select, SelectItem } from '../../../components/ui/select';
import { Dialog } from '../../../components/dialog';
import { useDesk } from '../../../lib/desk-session';
import { CsvLink } from '../../reports/report-kit';
import { Fact, Facts } from '../../../components/facts';
import { PageActions, ReasonTag, SectionHead, kindCellClass, type ReasonTone } from '../ledger-parts';
import { LossBadge } from '../../../components/loss-badge';

const KINDS = [
  'fund', 'self_fund', 'deduct', 'deduct_in', 'hold', 'release',
  'activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch', 'rename', 'sim', 'addon',
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
export function reasonTone(kind: string): ReasonTone {
  if (['activate', 'charge', 'extend', 'reactivate', 'esim'].includes(kind)) return 'leaf';
  if (kind === 'hold') return 'amber';
  if (['disconnect', 'deduct', 'deduct_in'].includes(kind)) return 'alarm';
  if (['fund', 'self_fund'].includes(kind)) return 'plum';
  return 'mute';
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
  // Every entry by default (owner 2026-11-09); «الحركات المالية فقط» keeps the money movements, «العمليات فقط» the
  // line operations (spec 2026-11-09-admin-review, 1; the old «العمليات» page lands here with `?scope=operations`).
  const [scope, setScope] = useState(() => {
    const asked = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('scope') ?? '';
    return asked === 'money' || asked === 'operations' ? asked : '';
  });
  const [chainOf, setChainOf] = useState<FinanceRow | null>(null);
  const { me } = useDesk();
  // The operations marked as the branch's loss (spec DB.5 P.7): a filter of the branch's only (the API refuses it to
  // any other layer, and sends the mark to the branch alone).
  const [loss, setLoss] = useState('');
  const branch = me?.layer === 'branch';
  const lossAsked = branch ? loss : '';
  const list = usePaged<FinanceRow>(`${kind}|${layer}|${q}|${from}|${to}|${scope}|${lossAsked}`, async (cursor) =>
    pick(await api.finance({ kind, layer, q, from, to, scope, loss: lossAsked, cursor }), pageRows),
  );

  // The design's ledger: the time, the reason as a coloured tag, what it was about, the amount, my margin, the balance
  // after. The account, its layer, who did it, the number and the package sit together in «التفاصيل».
  const columns: Column<FinanceRow>[] = [
    { key: 'when', header: t.when, kind: 'when', render: (row) => <bdi dir="ltr">{latinWhen(row.at)}</bdi> },
    {
      key: 'kind',
      header: t.reasonColumn,
      render: (row) => (
        <span className={kindCellClass}>
          <ReasonTag tone={reasonTone(row.kind)} data-testid={`reason-${reasonTone(row.kind)}`}>{movementName(t, row.kind)}</ReasonTag>
          <LossBadge loss={row.loss} />
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
      kind: 'wrap',
      render: (row) => (
        <span className="grid min-w-55 gap-0.5">
          <span>
            {[row.msisdn ? <bdi key="n" dir="ltr">{row.msisdn}</bdi> : null, row.packageName || null, row.companyName || null, row.note || null]
              .filter(Boolean)
              .reduce<ReactNode[]>((all, part, index) => (index ? [...all, ' · ', part] : [part]), [])}
            {!row.msisdn && !row.packageName && !row.note ? '—' : null}
          </span>
          <span className="block text-sm leading-1-3 font-normal text-muted">
            <AccountName login={row.loginName} />
            {row.layer ? <> · {layerName(t, row.layer)}</> : null}
            {row.actorLoginName && row.actorLoginName !== row.loginName ? <> · {t.actedBy}: <AccountName login={row.actorLoginName} /></> : null}
          </span>
        </span>
      ),
    },
    // Money in reads «+», money out «−»: the sign carries the direction, the colour only repeats it.
    { key: 'amount', header: t.amount, num: true, render: (row) => (row.amount === 0 ? '—' : <Money value={row.amount} signed />) },
    {
      key: 'margin',
      header: t.myMargin,
      num: true,
      render: (row) => {
        if (row.margin == null) return '—';
        if (!row.shares) return <Money value={row.margin} signed />;
        return (
          <Button type="button" variant="link" onClick={() => setChainOf(row)} title={t.sharesOpen} aria-label={`${t.sharesOpen}: ${row.msisdn}`}>
            <Money value={row.margin} signed />
          </Button>
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
        <PageActions>
          <CsvLink href={api.financeExportHref({ kind, layer, q, from, to, scope, loss: lossAsked })} />
          {me && me.layer !== 'pos' ? <Button asChild><Link href="/users"><Receipt size={16} aria-hidden="true" />{t.fundAccount}</Link></Button> : null}
        </PageActions>
      )}
      error=""
      note=""
    >
      <SectionHead title={t.movementsTitle} />
      <FilterBar loose onClear={() => { setKind(''); setLayer(''); setQ(''); setFrom(''); setTo(''); setScope(''); setLoss(''); }} clearLabel={t.clearFilters}>
        <label>
          {t.financeScope}
          <Select value={scope} onValueChange={setScope}>
            <SelectItem value="">{t.financeScopeAll}</SelectItem>
            <SelectItem value="money">{t.financeScopeMoney}</SelectItem>
            <SelectItem value="operations">{t.financeScopeOperations}</SelectItem>
          </Select>
        </label>
        <label>
          {t.kind}
          <Select value={kind} onValueChange={setKind}>
            <SelectItem value="">{t.allRows}</SelectItem>
            {KINDS.map((value) => (
              <SelectItem key={value} value={value}>{movementName(t, value)}</SelectItem>
            ))}
          </Select>
        </label>
        <label>
          {t.layer}
          <Select value={layer} onValueChange={setLayer}>
            <SelectItem value="">{t.allRows}</SelectItem>
            {LAYERS.map((value) => (
              <SelectItem key={value} value={value}>{layerName(t, value)}</SelectItem>
            ))}
          </Select>
        </label>
        {branch ? (
          <label>
            {t.lossFilter}
            <Select value={loss} onValueChange={setLoss}>
              <SelectItem value="">{t.allRows}</SelectItem>
              <SelectItem value="any">{t.lossAny}</SelectItem>
              <SelectItem value="given_back">{t.lossGivenBack}</SelectItem>
              <SelectItem value="priced_zero">{t.lossPricedZero}</SelectItem>
              <SelectItem value="charged_later">{t.lossChargedLater}</SelectItem>
            </Select>
          </label>
        ) : null}
        <label className="filter-search">
          <Search size={16} strokeWidth={1.9} aria-hidden="true" />
          <span className="sr-only">{t.financeSearch}</span>
          <input value={q} placeholder={t.financeSearch} onChange={(event) => setQ(event.target.value)} />
        </label>
        <label>
          {t.from}
          <DateField value={from} onChange={(next) => setFrom(next)} />
        </label>
        <label>
          {t.to}
          <DateField value={to} onChange={(next) => setTo(next)} />
        </label>
      </FilterBar>
      <Pane>
        <PagedTable list={list} columns={columns} rowKey={(row) => row.id} empty={t.noMovements} keepHead skeleton={{ rows: 6, columns: 6 }} />
      </Pane>
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
