'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { DataTable, type Column } from '../../../components/data-table';
import { Desk } from '../../../components/desk';
import { api } from '../../../lib/api';
import { usePrefs } from '../../../lib/prefs';
import { useAction } from '../../../lib/use-action';
import { useLoad } from '../../../lib/use-load';
import { useRequireLayer } from '../../../lib/use-require-layer';

const BRANCH = ['branch'];
const actions = ['activate', 'charge', 'extend', 'disconnect', 'freeze', 'switch', 'rename', 'sim'] as const;
type ModeAction = (typeof actions)[number];
type Tab = 'settings' | 'packages';

type PackageLine = {
  code: string;
  name: string;
  company: string;
  active: number;
  stopped: number;
};

export default function ProviderPackagesPage() {
  const { t } = usePrefs();
  const params = useParams<{ code: string }>();
  const [tab, setTab] = useState<Tab>('settings');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const allowed = useRequireLayer(BRANCH);
  const providers = useLoad(() => api.officeProviders(), [], { enabled: allowed });
  const shelf = useLoad(() => api.officeCompanies(), [], { enabled: allowed });
  const settings = useLoad(() => api.providerSettings(params.code), [params.code], { enabled: allowed });
  const { run } = useAction({ setError, setNote, onDone: settings.reload });
  const provider = providers.data?.providers.find((row) => row.code === params.code) ?? null;
  const named = shelf.data?.companies
    .flatMap((company) => company.providers)
    .find((item) => item.code === params.code)?.name;
  const title = settings.data?.name || provider?.name || named || '';

  const fromShelf: PackageLine[] | null = shelf.data
    ? shelf.data.companies.flatMap((company) => {
      const match = company.providers.find((item) => item.code === params.code);
      if (!match) return [];
      return match.packages.map((item) => ({
        code: item.code,
        name: item.name,
        company: company.name,
        active: item.activeLines,
        stopped: item.stoppedLines,
      }));
    })
    : null;

  const rows = fromShelf ?? (provider?.companies ?? []).flatMap((company) => (
    company.packages.map((item) => ({
      code: item.code,
      name: item.name,
      company: company.name,
      active: 0,
      stopped: 0,
    }))
  ));

  const names: Record<ModeAction, string> = {
    activate: t.actActivate,
    charge: t.actCharge,
    extend: t.extend,
    disconnect: t.actDisconnect,
    freeze: `${t.freeze} / ${t.unfreeze}`,
    switch: t.actSwitch,
    rename: t.updateNumber,
    sim: t.swapSim,
  };

  async function saveMode(action: string, mode: string) {
    await run(() => api.setProviderMode(params.code, action, mode));
  }

  const modeColumns: Column<ModeAction>[] = [
    { key: 'kind', header: t.kind, render: (action) => names[action] },
    {
      key: 'run',
      header: t.runTab,
      render: (action) => (
        <select
          className="mode-pick"
          value={settings.data?.modes[action] ?? 'manual'}
          onChange={(event) => void saveMode(action, event.target.value)}
        >
          <option value="auto">{t.automatic}</option>
          <option value="manual">{t.manual}</option>
          <option value="off">{t.stopped}</option>
        </select>
      ),
    },
  ];

  const columns: Column<PackageLine>[] = [
    {
      key: 'package',
      header: t.packageName,
      render: (row) => (
        <Link className="row-link" href={`/providers/${params.code}/${encodeURIComponent(row.code)}`}>{row.name}</Link>
      ),
    },
    { key: 'company', header: t.company, render: (row) => row.company },
    { key: 'active', header: t.activeNumbers, num: true, render: (row) => row.active },
    { key: 'stopped', header: t.stoppedLines, num: true, render: (row) => row.stopped },
  ];

  const tabs: { key: Tab; label: string }[] = [
    { key: 'settings', label: t.providerSettingsTab },
    { key: 'packages', label: t.packagesTab },
  ];

  return (
    <Desk title={title} lede="" error={error || providers.error || settings.error} note={note}>
      <section className="pane">
        <div className="steps" role="tablist">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {tab === 'settings' && (
          <div className="pane-body">
            <DataTable
              bare
              columns={modeColumns}
              rows={[...actions]}
              rowKey={(action) => action}
              loading={!settings.loaded}
              skeleton={{ rows: 8, columns: 2 }}
            />
          </div>
        )}
        {tab === 'packages' && (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.code}
            loading={!providers.loaded && !shelf.loaded}
            skeleton={{ rows: 6, columns: 4 }}
            empty={t.noPackages}
          />
        )}
      </section>
    </Desk>
  );
}
