'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { PagedTable, type Column } from '../../../components/data-table';
import { Desk, Money, Pane, latinWhen } from '../../../components/desk';
import { Button } from '../../../components/ui/button';
import { api, type LedgerRow } from '../../../lib/api';
import { pick } from '../../../lib/fetched';
import { usePrefs } from '../../../lib/prefs';
import { sharedKeys } from '../../../lib/query';
import { useApiQuery } from '../../../lib/use-api-query';
import { pageRows, usePaged } from '../../../lib/use-paged';
import { useRequireLayer } from '../../../lib/use-require-layer';
import { PageActions, ReasonTag, SectionHead } from '../ledger-parts';
import { WalletHead } from '../wallet-head';
import { movementName, reasonTone } from './finance-screen';

/**
 * «المحفظة» (spec 2026-11-09-offers-tasks-addons-wallet-esim, 4): the signed-in account's own wallet, for every
 * layer — the cards and the 30-day chart of the finance page, then its own movements. Top-up requests come later;
 * the button says so.
 */
export function WalletScreen() {
  const { t } = usePrefs();
  // The branch has no wallet: its balance is unlimited (spec 2026-11-09-admin-review, 7). It goes home.
  const allowed = useRequireLayer(['main_agent', 'agent', 'pos']);
  const [soon, setSoon] = useState('');
  const summary = useApiQuery(sharedKeys.financeSummary, () => api.financeSummary(), { enabled: allowed });
  const list = usePaged<LedgerRow>('wallet', async (cursor) =>
    pick(await api.ledger({ cursor }), pageRows),
  );
  const columns: Column<LedgerRow>[] = [
    { key: 'when', header: t.when, kind: 'when', render: (row) => <bdi dir="ltr">{latinWhen(row.at)}</bdi> },
    { key: 'kind', header: t.reasonColumn, render: (row) => <ReasonTag tone={reasonTone(row.kind)}>{movementName(t, row.kind)}</ReasonTag> },
    { key: 'detail', header: t.detailsColumn, render: (row) => [row.msisdn, row.packageName, row.note].filter(Boolean).join(' · ') || '—' },
    { key: 'amount', header: t.amount, num: true, render: (row) => <Money value={row.amount} signed /> },
    { key: 'after', header: t.balanceAfterShort, num: true, render: (row) => <Money value={row.balanceAfter} /> },
  ];
  if (!allowed) return null;
  return (
    <Desk
      title={t.walletPage}
      lede={t.walletPageLede}
      action={(
        <PageActions>
          <Button type="button" onClick={() => setSoon(t.topUpSoon)}><Plus size={16} aria-hidden="true" />{t.topUpRequest}</Button>
        </PageActions>
      )}
      error={summary.error}
      note={soon}
    >
      <WalletHead />
      <SectionHead title={t.walletMovements} />
      <Pane>
        <PagedTable list={list} columns={columns} rowKey={(row) => row.id} empty={t.noMovements} keepHead skeleton={{ rows: 6, columns: 5 }} />
      </Pane>
    </Desk>
  );
}
