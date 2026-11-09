'use client';

import Link from 'next/link';
import { DataTable, type Column } from '../../../components/data-table';
import { Desk, Money, latinWhen } from '../../../components/desk';
import { Badge } from '../../../components/ui/badge';
import { Stat, StatRow } from '../../../components/stat';
import { api, type ProviderAccount } from '../../../lib/api';
import { usePrefs } from '../../../lib/prefs';
import { useApiQuery } from '../../../lib/use-api-query';
import { useRequireLayer } from '../../../lib/use-require-layer';

const BRANCH = ['branch'];

/** «حسابات المزودين» (roadmap N7): our balance, credit, held and available money with every provider. */
export function ProviderAccountsScreen() {
  const { t } = usePrefs();
  const allowed = useRequireLayer(BRANCH);
  const read = useApiQuery(['office', 'provider-accounts'], () => api.providerAccounts(), { enabled: allowed });
  const data = read.data;
  const columns: Column<ProviderAccount>[] = [
    { key: 'name', header: t.provider, render: (row) => <Link className="row-link" href={`/provider-accounts/${row.code}`}>{row.name}</Link> },
    { key: 'purchases', header: t.purchases, num: true, sortValue: (row) => row.purchases, render: (row) => <Money value={row.purchases} /> },
    { key: 'paid', header: t.paidTotal, num: true, sortValue: (row) => row.payments + row.settlements, render: (row) => <Money value={row.payments + row.settlements} /> },
    { key: 'balance', header: t.balance, num: true, sortValue: (row) => row.balance, render: (row) => <Money value={row.balance} /> },
    { key: 'credit', header: t.creditLimit, num: true, sortValue: (row) => row.creditLimit, render: (row) => <Money value={row.creditLimit} /> },
    { key: 'held', header: t.held, num: true, sortValue: (row) => row.held, render: (row) => <Money value={row.held} /> },
    { key: 'available', header: t.available, num: true, sortValue: (row) => row.available, render: (row) => <Money value={row.available} /> },
    // Matching, simulated until real providers are connected (spec E).
    { key: 'source', header: t.matchSource, render: (row) => (row.matchSource === 'api' ? t.matchSourceApi : t.matchSourceStatement) },
    {
      key: 'matched',
      header: t.matchLast,
      render: (row) => row.matchOverdue
        ? <Badge variant="warning" dot>{t.matchOverdue}</Badge>
        : row.matchSource === 'api' ? t.matchSourceApi : row.lastMatchedAt ? <bdi dir="ltr">{latinWhen(row.lastMatchedAt)}</bdi> : t.matchNever,
    },
    { key: 'differences', header: t.matchOpenDifferences, num: true, sortValue: (row) => row.openDifferences ?? 0, render: (row) => (row.openDifferences ? <Badge variant="danger" dot>{row.openDifferences}</Badge> : <span className="num">0</span>) },
  ];
  return (
    <Desk title={allowed ? t.providerAccounts : ''} lede={t.providerAccountsLede} error={read.error} note="">
      <StatRow>
        <Stat icon="wallet" label={t.balancesTotal} value={data ? <Money value={data.totals.balance} /> : '—'} />
        <Stat icon="lock" tone="danger" label={t.owedToProviders} value={data ? <Money value={data.totals.owed} /> : '—'} />
        <Stat icon="tasks" tone="warning" label={t.held} value={data ? <Money value={data.totals.held} /> : '—'} meta={t.heldHint} />
      </StatRow>
      <section className="pane">
        <DataTable columns={columns} rows={data?.rows ?? []} rowKey={(row) => row.code} loading={!read.loaded} failed={read.error} onRetry={() => void read.reload()} empty={t.noRows} keepHead skeleton={{ rows: 3, columns: 7 }} />
      </section>
    </Desk>
  );
}
