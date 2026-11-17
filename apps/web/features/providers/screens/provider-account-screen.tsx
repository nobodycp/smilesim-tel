'use client';

import { DateField } from '../../../components/date-field';
import { Coins } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { DataTable, type Column } from '../../../components/data-table';
import { Desk, Money, Pane, actionName, latinWhen } from '../../../components/desk';
import { Dialog } from '../../../components/dialog';
import { FilterBar } from '../../../components/filter-bar';
import { Stat, StatRow } from '../../../components/stat';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { LossBadge } from '../../../components/loss-badge';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { CsvLink } from '../../reports/report-kit';
import { Select, SelectItem } from '../../../components/ui/select';
import { api, type ProviderLedgerRow } from '../../../lib/api';
import { cn } from '../../../lib/cn';
import { useCrumbs } from '../../../lib/crumbs';
import { parseShekel, shekelField } from '../../../lib/money';
import { useDesk } from '../../../lib/desk-session';
import { usePrefs } from '../../../lib/prefs';
import { useAction } from '../../../lib/use-action';
import { useApiQuery } from '../../../lib/use-api-query';
import { useRequireLayer } from '../../../lib/use-require-layer';
import { Tabs } from '../../../components/tabs';
import { Reconciliation } from '../reconciliation';
import { MatchingPane } from '../matching-pane';

const BRANCH = ['branch'];

/*
 * The look (ADR 0022):
 * - the page's actions: a wrapping inline row 8px apart, items centred;
 * - a movement's tag: an inline 22px row, 8px sides, 4px corners, 11.5px bold on one line; a payment
 *   `--rd-success` on `--rd-success-soft`, a settlement `--rd-muted` on `--rd-surface-2`, any other movement
 *   `--rd-warning` on `--rd-warning-soft`;
 * - the ledger is `Pane`, tucked under the filter bar;
 * - the dialog: a column 12px apart; fields are dialog labels and fields; its hints plain paragraphs.
 */
const PAGE_ACTIONS = 'inline-flex flex-wrap items-center gap-2';
const TAG = 'inline-flex h-5.5 items-center whitespace-nowrap rounded-xs px-2 text-caption font-bold';
const TAG_TONE = { payment: 'bg-success-soft text-success', settlement: 'bg-surface-2 text-muted', other: 'bg-warning-soft text-warning' };

/** One provider's account (roadmap N7): four cards, payments and the credit limit, and the ledger with its balance. */
export function ProviderAccountScreen() {
  const { t, apiText } = usePrefs();
  const params = useParams<{ code: string }>();
  const allowed = useRequireLayer(BRANCH);
  const { me } = useDesk();
  const canWrite = Boolean(me?.isBranchOwner || me?.grants.includes('accounting'));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [dialog, setDialog] = useState<'entry' | 'credit' | null>(null);
  const [kind, setKind] = useState<'payment' | 'settlement'>('payment');
  const [amount, setAmount] = useState('');
  const [text, setText] = useState('');
  const [credit, setCredit] = useState('');
  const [floor, setFloor] = useState('');
  const [tab, setTab] = useState<'ledger' | 'recon'>('ledger');
  const query = { from, to };
  const read = useApiQuery(['api', 'provider-account', params.code, query], () => api.providerAccount(params.code, query), { enabled: allowed });
  const summary = read.data?.summary;
  useCrumbs({ [`/provider-accounts/${encodeURIComponent(params.code)}`]: summary?.name });
  const { run, busy } = useAction({ setError, setNote, onDone: read.reload });

  function open(which: 'entry' | 'credit') {
    setError('');
    setKind('payment');
    setAmount('');
    setText('');
    setCredit(summary ? shekelField(summary.creditLimit) : '');
    setFloor(summary ? shekelField(summary.alertFloor ?? 0) : '');
    setDialog(which);
  }

  async function saveEntry() {
    const negative = kind === 'settlement' && amount.trim().startsWith('-');
    const value = parseShekel(amount.trim().replace(/^-/, ''));
    if (value === null || value === 0 || !text.trim()) {
      setError(apiText(!text.trim() ? 'أضف ملاحظة للتمويل' : 'بيانات غير صالحة'));
      return;
    }
    await run(() => api.addProviderEntry(params.code, { kind, amount: negative ? -value : value, note: text }), { note: t.saved, then: () => setDialog(null) });
  }

  async function saveCredit() {
    const value = parseShekel(credit);
    const floorValue = parseShekel(floor.trim().replace(/^-/, ''));
    if (value === null || floorValue === null) {
      setError(apiText('بيانات غير صالحة'));
      return;
    }
    const alertFloor = floor.trim().startsWith('-') ? -floorValue : floorValue;
    await run(() => api.setProviderCredit(params.code, value, alertFloor), { note: t.saved, then: () => setDialog(null) });
  }

  const kindName = (value: string) => (value === 'payment' ? t.providerPayment : value === 'settlement' ? t.reasonSettlement : actionName(t, value));
  const columns: Column<ProviderLedgerRow>[] = [
    { key: 'at', header: t.when, kind: 'when', render: (row) => <bdi dir="ltr">{latinWhen(row.at)}</bdi> },
    {
      key: 'kind',
      header: t.movement,
      render: (row) => (
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn(TAG, row.kind === 'payment' ? TAG_TONE.payment : row.kind === 'settlement' ? TAG_TONE.settlement : TAG_TONE.other)}>{kindName(row.kind)}</span>
          <LossBadge loss={row.loss} />
        </span>
      ),
    },
    { key: 'number', header: t.number, render: (row) => (row.msisdn ? <bdi dir="ltr">{row.msisdn}</bdi> : '—') },
    { key: 'package', header: t.packageName, render: (row) => row.packageName || '—' },
    { key: 'amount', header: t.amount, num: true, render: (row) => <Money value={row.amount} signed /> },
    { key: 'balance', header: t.balanceAfter, num: true, render: (row) => <Money value={row.balanceAfter} /> },
    { key: 'note', header: t.note, render: (row) => row.note || '—' },
  ];

  return (
    <Desk
      title={summary ? `${t.providerAccountLink} · ${summary.name}` : ''}
      lede={summary ? t.providerAccountLede.replace('{name}', summary.name) : ''}
      action={summary ? (
        // As in the design: edit the credit, then record a payment (the page's action); the CSV beside them.
        <div className={PAGE_ACTIONS}>
          <CsvLink href={api.providerAccountExportHref(params.code, query)} />
          {canWrite ? <Button type="button" variant="secondary" onClick={() => open('credit')}>{t.editCredit}</Button> : null}
          {canWrite ? <Button type="button" onClick={() => open('entry')}><Coins size={16} aria-hidden="true" />{t.recordPayment}</Button> : null}
        </div>
      ) : null}
      error={error || read.error}
      note={note}
    >
      <StatRow>
        <Stat icon="wallet" label={t.balance} value={summary ? <Money value={summary.balance} /> : '—'} meta={summary ? `${t.purchases} ${shekelField(summary.purchases)} · ${t.paidTotal} ${shekelField(summary.payments + summary.settlements)}` : undefined} />
        <Stat icon="lock" label={t.creditLimit} value={summary ? <Money value={summary.creditLimit} /> : '—'} progress={summary && summary.creditLimit > 0 ? Math.max(0, -summary.balance) / summary.creditLimit : null} />
        <Stat icon="tasks" tone="warning" label={t.held} value={summary ? <Money value={summary.held} /> : '—'} meta={t.heldHint} />
        <Stat icon="plans" label={t.available} value={summary ? <Money value={summary.available} /> : '—'} highlight />
      </StatRow>
      <Tabs items={[{ key: 'ledger', label: t.providerLedger }, { key: 'recon', label: t.reconTitle }]} value={tab} onChange={setTab} />
      {tab === 'recon' ? (
        <>
          {/* The matching's source and schedule live with the matching (design: «المطابقة» tab). */}
          {summary ? <MatchingPane summary={summary} canWrite={canWrite} run={run} busy={busy} /> : null}
          <Reconciliation code={params.code} canWrite={canWrite} setError={setError} setNote={setNote} />
        </>
      ) : (
        <>
      <FilterBar onClear={() => { setFrom(''); setTo(''); }} clearLabel={t.clearFilters}>
        <label>
          {t.from}
          <DateField value={from} onChange={(next) => setFrom(next)} />
        </label>
        <label>
          {t.to}
          <DateField value={to} onChange={(next) => setTo(next)} />
        </label>
        {/* Paid at the provider, not charged to the point of sale (spec DB.5 P.7): the count, linking to the list of them. */}
        {summary?.losses ? (
          <Link className="no-underline" href={`/provider-operations?provider=${encodeURIComponent(summary.code)}&loss=any`}>
            <Badge variant="danger" dot>{t.providerLossesCount.replace('{n}', String(summary.losses))}</Badge>
          </Link>
        ) : null}
      </FilterBar>
      <Pane>
        <DataTable columns={columns} rows={read.data?.ledger ?? []} rowKey={(row) => row.id} loading={!read.loaded} failed={read.error} onRetry={() => void read.reload()} empty={t.noRows} keepHead skeleton={{ rows: 5, columns: 7 }} />
      </Pane>
        </>
      )}
      <Dialog
        open={dialog !== null}
        size="form"
        title={dialog === 'credit' ? t.creditLimit : t.recordPayment}
        lede={summary?.name ?? ''}
        mark="wallet"
        closeLabel={t.cancel}
        error={error}
        onClose={() => { if (!busy) setDialog(null); }}
        footer={(
          <>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setDialog(null)}>{t.cancel}</Button>
            <Button type="button" disabled={busy} onClick={() => void (dialog === 'credit' ? saveCredit() : saveEntry())}>{t.save}</Button>
          </>
        )}
      >
        <div className="grid gap-3">
          {dialog === 'credit' ? (
            <>
              <Label tone="dialog">
                {t.creditLimit}
                <Input inputMode="decimal" dir="ltr" value={credit} onChange={(event) => setCredit(event.target.value)} />
              </Label>
              <Label tone="dialog">
                {t.alertFloor}
                <Input inputMode="decimal" dir="ltr" value={floor} onChange={(event) => setFloor(event.target.value)} />
              </Label>
              <p>{t.alertFloorHint}</p>
            </>
          ) : (
            <>
              <Label tone="dialog">
                {t.kind}
                <Select place="dialog" value={kind} onValueChange={(next) => setKind(next as 'payment' | 'settlement')}>
                  <SelectItem value="payment">{t.providerPayment}</SelectItem>
                  <SelectItem value="settlement">{t.reasonSettlement}</SelectItem>
                </Select>
              </Label>
              <Label tone="dialog">
                {t.amount}
                <Input inputMode="decimal" dir="ltr" value={amount} onChange={(event) => setAmount(event.target.value)} />
              </Label>
              {kind === 'settlement' ? <p>{t.settlementSignHint}</p> : null}
              <Label tone="dialog">
                {t.note}
                <Input value={text} onChange={(event) => setText(event.target.value)} />
              </Label>
            </>
          )}
        </div>
      </Dialog>
    </Desk>
  );
}
