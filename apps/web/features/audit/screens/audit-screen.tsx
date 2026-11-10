'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { AccountName } from '../../../components/account-name';
import { PagedTable, type Column } from '../../../components/data-table';
import { Desk, actionName, latinWhen, layerName } from '../../../components/desk';
import { FilterBar } from '../../../components/filter-bar';
import { Stat, StatRow } from '../../../components/stat';
import { Badge } from '../../../components/ui/badge';
import { api, type ActivityRow } from '../../../lib/api';
import { usePrefs } from '../../../lib/prefs';
import { pick } from '../../../lib/fetched';
import { pageRows, usePaged } from '../../../lib/use-paged';
import { Select } from '../../../components/ui/select';
import { useApiQuery } from '../../../lib/use-api-query';
import { CsvLink, Period, ReportFilters, periodFrom, type PeriodDays } from '../../reports/report-kit';

// Every action the API logs (apps/api `ACTIVITY_ACTIONS`), in the order the menu shows them: sign-in, accounts,
// money, numbers, tasks, catalog, providers. `check:copy` fails when the two lists differ.
const ACTIONS = [
  'login', 'logout', 'password', 'two_factor', 'passkey_add', 'passkey_remove', 'session_rules',
  'user_create', 'user_freeze', 'user_restore', 'user_delete', 'user_transfer', 'user_contact', 'access', 'role_save', 'enter', 'leave',
  'fund', 'deduct', 'ceiling',
  'activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch', 'rename', 'sim', 'esim', 'refresh', 'addon', 'transfer', 'company_switch',
  'task_take', 'task_release', 'task_note', 'task_complete', 'task_reject', 'task_cancel',
  'company_add', 'company_sim', 'company_image', 'package_add', 'package_mode', 'package_price', 'package_chain', 'package_details', 'package_reprice',
  'package_renewals', 'package_switches', 'package_addon', 'user_package', 'user_ops', 'sell_price', 'offer',
  'provider_mode', 'provider_esim_price', 'provider_payment', 'provider_credit', 'provider_matching', 'provider_statement', 'provider_reconcile', 'provider_reconcile_item',
] as const;

const LAYERS = ['branch', 'main_agent', 'agent', 'pos'] as const;

export function AuditScreen() {
  const { t } = usePrefs();
  const errors = t.errors as Record<string, string | undefined>;
  const [action, setAction] = useState('');
  const [result, setResult] = useState('');
  const [layer, setLayer] = useState('');
  const [q, setQ] = useState('');
  const [days, setDays] = useState<PeriodDays>(30);
  const from = periodFrom(days);
  const to = '';
  // The figures: the events of the period under the filters, failed sign-ins and price changes.
  const failed = useApiQuery(['office', 'audit', 'failed-logins', from], () => api.officeAudit({ action: 'login', result: 'fail', from, addresses: '1' }));
  const prices = useApiQuery(['office', 'audit', 'price-edits', from], () => api.officeAudit({ action: 'package_price', from }));
  const list = usePaged<ActivityRow>(`${action}|${result}|${layer}|${q}|${from}|${to}`, async (cursor) =>
    pick(await api.officeAudit({ action, result, layer, q, from, to, cursor }), pageRows),
  );

  const columns: Column<ActivityRow>[] = [
    { key: 'when', header: t.when, cell: 'when', render: (row) => <bdi dir="ltr">{latinWhen(row.at)}</bdi> },
    {
      key: 'account',
      header: t.auditWho,
      render: (row) => (
        <span className="who-cell">
          <AccountName login={row.actorLoginName} />
          {row.actorLayer ? <span className={`layer-tag l-${row.actorLayer}`}>{layerName(t, row.actorLayer)}</span> : null}
        </span>
      ),
    },
    { key: 'action', header: t.auditEvent, render: (row) => actionName(t, row.action) },
    {
      key: 'subject',
      header: t.auditOn,
      render: (row) => {
        if (!row.subjectRef) return '—';
        if (row.subjectKind === 'task') return <Link className="row-link" href={`/tasks/${row.subjectRef}`}>{t.openTask}</Link>;
        return <bdi dir="ltr">{row.subjectRef}</bdi>;
      },
    },
    {
      key: 'result',
      header: t.activityResult,
      render: (row) => (
        <>
          <Badge variant={row.result === 'fail' ? 'danger' : 'success'} dot>{row.result === 'fail' ? t.activityFailure : t.activitySuccess}</Badge>
          {row.result === 'fail' && row.reason ? <span className="sub">{errors[row.reason] ?? row.reason}</span> : null}
        </>
      ),
    },
    { key: 'ip', header: t.auditAddress, render: (row) => (row.ip ? <bdi dir="ltr" className="muted">{row.ip.replace(/^::ffff:/, '')}</bdi> : '—') },
  ];

  function clear() {
    setAction('');
    setResult('');
    setLayer('');
    setQ('');
  }

  return (
    <Desk title={t.navAudit} lede={t.auditLede} action={<CsvLink href={api.auditExportHref({ action, result, layer, q, from, to })} />} error="" note="">
      <ReportFilters>
        <Period days={days} onPick={setDays} />
        <FilterBar loose onClear={clear} clearLabel={t.clearFilters}>
          <label className="filter-search">
            <Search size={16} strokeWidth={1.9} aria-hidden="true" />
            <span className="sr-only">{t.activitySearch}</span>
            <input value={q} placeholder={t.activitySearch} onChange={(event) => setQ(event.target.value)} />
          </label>
          <label>
            {t.auditEvent}
            <Select value={action} onChange={(event) => setAction(event.target.value)}>
              <option value="">{t.allRows}</option>
              {ACTIONS.map((value) => (
                <option key={value} value={value}>{actionName(t, value)}</option>
              ))}
            </Select>
          </label>
          <label>
            {t.activityResult}
            <Select value={result} onChange={(event) => setResult(event.target.value)}>
              <option value="">{t.allRows}</option>
              <option value="ok">{t.activitySuccess}</option>
              <option value="fail">{t.activityFailure}</option>
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
        </FilterBar>
      </ReportFilters>
      <StatRow>
        <Stat label={t.auditEvents} value={list.total ?? '—'} meta={t.lastDaysMeta.replace('{n}', String(days))} />
        <Stat tone="danger" label={t.failedLogins} value={failed.data ? <span className={failed.data.total ? 'tone-danger' : undefined}>{failed.data.total}</span> : '—'} meta={failed.data?.addresses !== undefined ? (failed.data.addresses === 1 ? t.fromOneAddressMeta : t.fromAddressesMeta.replace('{n}', String(failed.data.addresses))) : t.lastDaysMeta.replace('{n}', String(days))} />
        <Stat label={t.priceEdits} value={prices.data ? prices.data.total : '—'} meta={t.lastDaysMeta.replace('{n}', String(days))} />
      </StatRow>
      <section className="pane">
        <PagedTable list={list} columns={columns} rowKey={(row) => row.id} empty={t.noMovements} keepHead skeleton={{ rows: 6, columns: 6 }} />
      </section>
    </Desk>
  );
}
