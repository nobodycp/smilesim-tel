'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { PagedTable, type Column } from '../../../components/data-table';
import { Desk, Money, latinWhen } from '../../../components/desk';
import { Button } from '../../../components/ui/button';
import { api, type LedgerRow } from '../../../lib/api';
import { pick } from '../../../lib/fetched';
import { usePrefs } from '../../../lib/prefs';
import { sharedKeys } from '../../../lib/query';
import { useApiQuery } from '../../../lib/use-api-query';
import { usePaged } from '../../../lib/use-paged';
import { WalletHead, movementName, reasonTone } from './finance-screen';

/**
 * «المحفظة» (spec 2026-11-09-offers-tasks-addons-wallet-esim, 4): the signed-in account's own wallet, for every
 * layer — the cards and the 30-day chart of the finance page, then its own movements. Top-up requests come later;
 * the button says so.
 */
export function WalletScreen() {
  const { t } = usePrefs();
  const [soon, setSoon] = useState('');
  const summary = useApiQuery(sharedKeys.financeSummary, () => api.financeSummary());
  const list = usePaged<LedgerRow>('wallet', async (cursor) =>
    pick(await api.officeLedger('audit', { cursor }), (data) => ({ rows: data.entries, next: data.nextCursor, total: data.total })),
  );
  const columns: Column<LedgerRow>[] = [
    { key: 'when', header: t.when, cell: 'when', render: (row) => <bdi dir="ltr">{latinWhen(row.at)}</bdi> },
    { key: 'kind', header: t.reasonColumn, render: (row) => <span className={`reason ${reasonTone(row.kind)}`}>{movementName(t, row.kind)}</span> },
    { key: 'detail', header: t.detailsColumn, render: (row) => [row.msisdn, row.packageName, row.note].filter(Boolean).join(' · ') || '—' },
    { key: 'amount', header: t.amount, num: true, render: (row) => <Money value={row.amount} signed /> },
    { key: 'after', header: t.balanceAfterShort, num: true, render: (row) => <Money value={row.balanceAfter} /> },
  ];
  return (
    <Desk
      title={t.walletPage}
      lede={t.walletPageLede}
      action={(
        <div className="page-actions">
          <Button type="button" onClick={() => setSoon(t.topUpSoon)}><Plus size={16} aria-hidden="true" />{t.topUpRequest}</Button>
        </div>
      )}
      error={summary.error}
      note={soon}
    >
      <WalletHead />
      <div className="section-head"><h2>{t.walletMovements}</h2></div>
      <section className="pane">
        <PagedTable list={list} columns={columns} rowKey={(row) => row.id} empty={t.noMovements} keepHead skeleton={{ rows: 6, columns: 5 }} />
      </section>
    </Desk>
  );
}
