'use client';

import { Download } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { DataTable, type Column } from '../../../components/data-table';
import { Desk, Money, actionName, latinWhen } from '../../../components/desk';
import { Dialog } from '../../../components/dialog';
import { FilterBar } from '../../../components/filter-bar';
import { Stat, StatRow } from '../../../components/stat';
import { Badge } from '../../../components/ui/badge';
import { Button, buttonClass } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { api, type ProviderLedgerRow } from '../../../lib/api';
import { useCrumbs } from '../../../lib/crumbs';
import { parseShekel, shekelField } from '../../../lib/money';
import { useOffice } from '../../../lib/office-session';
import { usePrefs } from '../../../lib/prefs';
import { useAction } from '../../../lib/use-action';
import { useApiQuery } from '../../../lib/use-api-query';
import { useRequireLayer } from '../../../lib/use-require-layer';
import { Tabs } from '../../../components/tabs';
import { Reconciliation } from '../reconciliation';
import { MatchingPane } from '../matching-pane';

const BRANCH = ['branch'];

/** One provider's account (roadmap N7): four cards, payments and the credit limit, and the ledger with its balance. */
export function ProviderAccountScreen() {
  const { t, apiText } = usePrefs();
  const params = useParams<{ code: string }>();
  const allowed = useRequireLayer(BRANCH);
  const { me } = useOffice();
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
  const read = useApiQuery(['office', 'provider-account', params.code, query], () => api.providerAccount(params.code, query), { enabled: allowed });
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
    { key: 'at', header: t.when, cell: 'when', render: (row) => <bdi dir="ltr">{latinWhen(row.at)}</bdi> },
    {
      key: 'kind',
      header: t.movement,
      render: (row) => (row.kind === 'payment' || row.kind === 'settlement'
        ? <Badge variant={row.kind === 'payment' ? 'success' : 'muted'} dot>{kindName(row.kind)}</Badge>
        : kindName(row.kind)),
    },
    { key: 'number', header: t.number, render: (row) => (row.msisdn ? <bdi dir="ltr">{row.msisdn}</bdi> : '—') },
    { key: 'package', header: t.packageName, render: (row) => row.packageName || '—' },
    { key: 'amount', header: t.amount, num: true, render: (row) => <Money value={row.amount} signed /> },
    { key: 'balance', header: t.balanceAfter, num: true, render: (row) => <Money value={row.balanceAfter} /> },
    { key: 'note', header: t.note, render: (row) => row.note || '—' },
  ];

  return (
    <Desk
      title={summary?.name ?? ''}
      lede={t.providerAccountsLede}
      action={canWrite && summary ? (
        <div className="page-actions">
          <Button type="button" onClick={() => open('entry')}>{t.recordPayment}</Button>
          <Button type="button" variant="outline" onClick={() => open('credit')}>{t.creditLimit}</Button>
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
      {summary ? <MatchingPane summary={summary} canWrite={canWrite} run={run} busy={busy} /> : null}
      <Tabs items={[{ key: 'ledger', label: t.providerLedger }, { key: 'recon', label: t.reconTitle }]} value={tab} onChange={setTab} />
      {tab === 'recon' ? <Reconciliation code={params.code} canWrite={canWrite} setError={setError} setNote={setNote} /> : (
        <>
      <div className="section-head">
        <h2>{t.providerLedger}</h2>
        <a className={buttonClass({ variant: 'outline', size: 'sm' })} href={api.providerAccountExportHref(params.code, query)} download>
          <Download size={15} aria-hidden="true" />
          {t.exportCsv}
        </a>
      </div>
      <FilterBar onClear={() => { setFrom(''); setTo(''); }} clearLabel={t.clearFilters}>
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
        <DataTable columns={columns} rows={read.data?.ledger ?? []} rowKey={(row) => row.id} loading={!read.loaded} failed={read.error} onRetry={() => void read.reload()} empty={t.noRows} keepHead skeleton={{ rows: 5, columns: 7 }} />
      </section>
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
        <div className="dialog-form">
          {dialog === 'credit' ? (
            <>
              <label>
                {t.creditLimit}
                <input inputMode="decimal" dir="ltr" value={credit} onChange={(event) => setCredit(event.target.value)} />
              </label>
              <label>
                {t.alertFloor}
                <input inputMode="decimal" dir="ltr" value={floor} onChange={(event) => setFloor(event.target.value)} />
              </label>
              <p className="hint">{t.alertFloorHint}</p>
            </>
          ) : (
            <>
              <label>
                {t.kind}
                <Select value={kind} onChange={(event) => setKind(event.target.value as 'payment' | 'settlement')}>
                  <option value="payment">{t.providerPayment}</option>
                  <option value="settlement">{t.reasonSettlement}</option>
                </Select>
              </label>
              <label>
                {t.amount}
                <input inputMode="decimal" dir="ltr" value={amount} onChange={(event) => setAmount(event.target.value)} />
              </label>
              {kind === 'settlement' ? <p className="hint">{t.settlementSignHint}</p> : null}
              <label>
                {t.note}
                <input value={text} onChange={(event) => setText(event.target.value)} />
              </label>
            </>
          )}
        </div>
      </Dialog>
    </Desk>
  );
}
