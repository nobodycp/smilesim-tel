'use client';

import { DateField } from '../../../components/date-field';
import { Receipt, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '../../../components/ui/button';
import { AccountName } from '../../../components/account-name';
import { PagedTable, type Column, type RowMore } from '../../../components/data-table';
import { Desk, Money, Pane, actionName, latinWhen, layerName } from '../../../components/desk';
import { FilterBar } from '../../../components/filter-bar';
import { api, type FinanceRow } from '../../../lib/api';
import type { Copy } from '../../../lib/copy';
import { usePrefs } from '../../../lib/prefs';
import { pick } from '../../../lib/fetched';
import { pageRows, usePaged } from '../../../lib/use-paged';
import { Badge } from '../../../components/ui/badge';
import { Select, SelectItem } from '../../../components/ui/select';
import { useDesk } from '../../../lib/desk-session';
import { CsvLink } from '../../reports/report-kit';
import { PageActions, ReasonTag, SectionHead, cellSubClass, kindCellClass, type ReasonTone } from '../ledger-parts';
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
  // The money by default (the owner's point 7 of 2026-11-19: the movements on the wallets; the API's predicate);
  // «كل العمليات» (`all`) every entry, the operations that moved nothing included; «العمليات فقط» the line operations
  // (spec 2026-11-09-admin-review, 1; the home's «كل العمليات» link lands here with `?scope=operations`). An old
  // `?scope=money` is the default.
  const [scope, setScope] = useState(() => {
    const asked = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('scope') ?? '';
    return asked === 'all' || asked === 'operations' ? asked : '';
  });
  const { me } = useDesk();
  // The operations marked as the branch's loss (spec DB.5 P.7): a filter of the branch's only (the API refuses it to
  // any other layer, and sends the mark to the branch alone).
  const [loss, setLoss] = useState('');
  const branch = me?.layer === 'branch';
  const lossAsked = branch ? loss : '';
  const list = usePaged<FinanceRow>(`${kind}|${layer}|${q}|${from}|${to}|${scope}|${lossAsked}`, async (cursor) =>
    pick(await api.finance({ kind, layer, q, from, to, scope, loss: lossAsked, cursor }), pageRows),
  );

  // One fact a column (spec 2026-11-19-finance-ledger-columns, the owner's change of 2026-11-19): the amount is the
  // movement on the wallet, for every viewer; the balance before and after are around it; everything else explains
  // it. The time, the reason, the account (for a viewer with accounts below it), the number, the package, the amount,
  // the viewer's own cost, sell and margin (a sale or refund only), the balance before and after. When the width is
  // short the package leaves first, then the sell price, the margin, the account and the cost (`fold`); the arrow
  // reads them under the row, with the facts that have no column. The time, the reason, the number, the amount and
  // the two balances always stay.
  const pos = me?.layer === 'pos';
  const none = '—';
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
          {/* An eSIM sale pays the package price plus a fee in one entry: a quick mark here, the fee under the arrow. */}
          {row.esimPrice != null && row.kind !== 'esim' && (
            <Badge variant="muted" dot title={t.esimSaleTagTitle}>{t.esimSaleTag}</Badge>
          )}
        </span>
      ),
    },
    ...(pos ? [] : [{
      key: 'account',
      header: t.account,
      fold: 4,
      render: (row: FinanceRow) => (
        <span className="grid gap-0.5">
          <AccountName login={row.loginName} />
          {row.layer ? <span className={cellSubClass}>{layerName(t, row.layer)}</span> : null}
        </span>
      ),
    }]),
    { key: 'number', header: t.number, kind: 'msisdn', render: (row) => (row.msisdn ? <bdi dir="ltr">{row.msisdn}</bdi> : none) },
    {
      key: 'package',
      header: t.packageName,
      fold: 1,
      cell: 'whitespace-normal',
      render: (row) => (row.packageName ? (
        <span className="grid gap-0.5">
          <span>{row.packageName}</span>
          {row.companyName ? <span className={cellSubClass}>{row.companyName}</span> : null}
        </span>
      ) : none),
    },
    // Money in reads «+», money out «−»: the sign carries the direction, the colour only repeats it.
    { key: 'amount', header: t.amount, num: true, render: (row) => (row.amount === 0 ? none : <Money value={row.amount} signed />) },
    // The viewer's own prices on a sale or refund, from the entry's stored ladder: never the movement (an eSIM sale's
    // amount holds the fee beside the package's cost). Empty on any other row.
    { key: 'cost', header: t.costPrice, num: true, fold: 5, render: (row) => (row.cost == null ? none : <Money value={row.cost} />) },
    { key: 'sell', header: t.sellPrice, num: true, fold: 2, render: (row) => (row.sell == null ? none : <Money value={row.sell} />) },
    { key: 'margin', header: t.margin, num: true, fold: 3, render: (row) => (row.margin == null ? none : <Money value={row.margin} signed />) },
    { key: 'before', header: t.balanceBefore, num: true, render: (row) => <Money value={row.balanceBefore} /> },
    { key: 'after', header: t.balanceAfter, num: true, render: (row) => <Money value={row.balanceAfter} /> },
  ];

  // What the arrow opens besides the folded columns: the facts no column holds.
  const more: RowMore<FinanceRow> = {
    label: t.rowDetails,
    facts: (row) => [
      ...(row.actorLoginName && row.actorLoginName !== row.loginName ? [{ key: 'actor', label: t.actedBy, value: <AccountName login={row.actorLoginName} /> }] : []),
      ...(row.note ? [{ key: 'note', label: t.note, value: row.note }] : []),
      // An eSIM sale pays the package price plus this fee in one entry.
      ...(row.esimPrice != null && row.kind !== 'esim' ? [{ key: 'esim', label: t.esimFee, value: <Money value={row.esimPrice} /> }] : []),
      ...(row.held ? [{ key: 'held', label: t.held, value: <Money value={Math.abs(row.held)} /> }] : []),
      ...(row.loss ? [{ key: 'loss', label: t.lossFilter, value: <LossBadge loss={row.loss} /> }] : []),
      // The branch: what every account in the sale's chain earned on it, branch first.
      ...(row.shares?.length ? [{
        key: 'shares',
        label: t.sharesTitle,
        value: (
          <span className="grid gap-0.5">
            {row.shares.map((share) => (
              <span key={share.loginName}>
                {layerName(t, share.layer)} · <AccountName login={share.loginName} />: <Money value={share.margin} signed />
              </span>
            ))}
          </span>
        ),
      }] : []),
    ],
  };

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
            <SelectItem value="">{t.financeScopeMoney}</SelectItem>
            <SelectItem value="all">{t.financeScopeAll}</SelectItem>
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
        <PagedTable list={list} columns={columns} more={more} rowKey={(row) => row.id} empty={t.noMovements} keepHead skeleton={{ rows: 6, columns: 8 }} />
      </Pane>
    </Desk>
  );
}
