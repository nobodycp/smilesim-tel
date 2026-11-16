'use client';

import Link from 'next/link';
import { DataTable, type Column } from '../../../components/data-table';
import { useRouter } from 'next/navigation';
import { Desk, Money, Pane } from '../../../components/desk';
import { RowMenu } from '../../../components/row-menu';
import { useDesk } from '../../../lib/desk-session';
import { useApiQuery } from '../../../lib/use-api-query';
import { sharedKeys } from '../../../lib/query';
import { api, type ProviderRow } from '../../../lib/api';
import { cn } from '../../../lib/cn';
import { usePrefs } from '../../../lib/prefs';
import { useRequireLayer } from '../../../lib/use-require-layer';

const BRANCH = ['branch'];

/*
 * The look (Tailwind migration T4.4, ADR 0022), ported from table.css and graphite.css: a provider's name and its
 * account figures are bold links; its companies `--rd-muted`; how its activations run a 22px tag (8px sides, 4px
 * corners, 11.5px bold, on one line) on the tone's soft fill in the tone's colour — automatic `--rd-success`, manual
 * `--rd-warning`, mixed `--rd-muted` on `--rd-surface-2`.
 */
const RUNS_TONE = {
  leaf: 'bg-success-soft text-success',
  amber: 'bg-warning-soft text-warning',
  mute: 'bg-surface-2 text-muted',
} as const;
const RUNS_TAG = 'inline-flex h-5.5 items-center whitespace-nowrap rounded-xs px-2 text-caption font-bold';

export function ProvidersScreen() {
  const { t } = usePrefs();
  const allowed = useRequireLayer(BRANCH);
  const router = useRouter();
  const { me } = useDesk();
  const providers = useApiQuery(sharedKeys.providers, () => api.providers(), { enabled: allowed });
  const shelf = useApiQuery(sharedKeys.companies, () => api.companies(), { enabled: allowed });


  // The list as in the approved design: the provider, its companies, its packages, how its activations run, and your
  // account with it (balance and credit, for those who keep the accounts); ⋯ opens the provider or its account.
  const canAccount = Boolean(me?.isBranchOwner || me?.grants?.includes('accounting'));
  const accounts = useApiQuery(['api', 'provider-accounts'], () => api.providerAccounts(), { enabled: allowed && canAccount });
  const accountOf = (code: string) => accounts.data?.rows.find((row) => row.code === code);
  const runsOf = (provider: ProviderRow) => {
    const all = provider.companies.flatMap((company) => company.packages);
    const auto = all.filter((item) => item.autoActivate).length;
    if (all.length === 0 || auto === 0) return { label: t.manual, tone: 'amber' as const };
    if (auto === all.length) return { label: t.automatic, tone: 'leaf' as const };
    return { label: t.mixedMode, tone: 'mute' as const };
  };
  const columns: Column<ProviderRow>[] = [
    { key: 'provider', header: t.provider, render: (provider) => <Link className="font-bold" href={`/providers/${provider.code}`}>{provider.name}</Link> },
    { key: 'companies', header: t.companiesColumn, render: (provider) => <span className="text-muted">{provider.companies.map((company) => company.name).join(' · ') || '—'}</span> },
    { key: 'packages', header: t.navPlans, num: true, render: (provider) => provider.companies.reduce((sum, company) => sum + company.packages.length, 0) },
    {
      key: 'runs',
      header: t.runsColumn,
      render: (provider) => {
        const runs = runsOf(provider);
        return <span className={cn(RUNS_TAG, RUNS_TONE[runs.tone])}>{runs.label}</span>;
      },
    },
    ...(canAccount ? [
      // Read-only here, each a link to the provider's account, the one place that changes them (spec
      // 2026-11-09-admin-review, 4).
      { key: 'balance', header: t.balanceWithProvider, num: true, render: (provider: ProviderRow) => { const row = accountOf(provider.code); return row ? <Link className="font-bold" href={`/provider-accounts/${provider.code}`}><Money value={row.balance} /></Link> : '—'; } },
      { key: 'credit', header: t.creditLimit, num: true, render: (provider: ProviderRow) => { const row = accountOf(provider.code); return row ? <Link className="font-bold" href={`/provider-accounts/${provider.code}`}><Money value={row.creditLimit} muted /></Link> : '—'; } },
    ] : []),
    {
      key: 'ops',
      header: <span className="sr-only">{t.rowActions}</span>,
      actions: true,
      render: (provider) => (
        <RowMenu
          label={`${t.rowActions} ${provider.name}`}
          items={[
            { label: t.providerSettingsTab, icon: 'enter', onClick: () => router.push(`/providers/${provider.code}`) },
            ...(canAccount ? [{ label: t.providerAccountLink, icon: 'enter' as const, onClick: () => router.push(`/provider-accounts/${provider.code}`) }] : []),
          ]}
        />
      ),
    },
  ];

  return (
    <Desk title={allowed ? t.providersTitle : ''} lede={t.providersLede} error={shelf.error} note="">
      <Pane>
        <DataTable columns={columns} rows={providers.data?.providers ?? []} rowKey={(provider) => provider.code} loading={!providers.loaded} failed={providers.error} onRetry={() => void providers.reload()} skeleton={{ rows: 5, columns: 7 }} />
      </Pane>
    </Desk>
  );
}
