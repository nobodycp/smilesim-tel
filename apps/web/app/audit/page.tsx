'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PagedTable, type Column } from '../../components/data-table';
import { Desk, actionName, latinWhen, layerName } from '../../components/desk';
import { FilterBar } from '../../components/filter-bar';
import { api, type ActivityRow } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';
import { pick } from '../../lib/use-load';
import { usePaged } from '../../lib/use-paged';

const ACTIONS = [
  'login', 'logout', 'password', 'two_factor',
  'user_create', 'user_freeze', 'user_restore', 'user_delete', 'access', 'enter', 'leave',
  'fund',
  'activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch', 'rename', 'sim',
  'task_take', 'task_release', 'task_note', 'task_complete', 'task_reject', 'task_cancel',
  'provider_mode', 'company_sim', 'package_mode', 'package_price', 'package_chain', 'offer',
] as const;

const LAYERS = ['branch', 'main_agent', 'agent', 'pos'] as const;

export default function AuditPage() {
  const { t } = usePrefs();
  const errors = t.errors as Record<string, string | undefined>;
  const [action, setAction] = useState('');
  const [result, setResult] = useState('');
  const [layer, setLayer] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const list = usePaged<ActivityRow>(`${action}|${result}|${layer}|${q}|${from}|${to}`, async (cursor) =>
    pick(await api.officeAudit({ action, result, layer, q, from, to, cursor }), (data) => ({ rows: data.entries, next: data.nextCursor, total: data.total })),
  );

  const columns: Column<ActivityRow>[] = [
    { key: 'when', header: t.when, cell: 'when', render: (row) => <bdi dir="ltr">{latinWhen(row.at)}</bdi> },
    { key: 'layer', header: t.layer, render: (row) => (row.actorLayer ? layerName(t, row.actorLayer) : '—') },
    { key: 'account', header: t.accountName, render: (row) => (row.actorLogin ? <bdi dir="ltr">{row.actorLogin}</bdi> : '—') },
    { key: 'action', header: t.kind, render: (row) => actionName(t, row.action) },
    {
      key: 'result',
      header: t.activityResult,
      render: (row) => (
        <span className={row.result === 'fail' ? 'result-fail' : 'result-ok'}>
          {row.result === 'fail' ? t.activityFailure : t.activitySuccess}
        </span>
      ),
    },
    { key: 'reason', header: t.activityReason, render: (row) => (row.reason ? (errors[row.reason] ?? row.reason) : '—') },
    {
      key: 'subject',
      header: t.activitySubject,
      render: (row) => {
        if (!row.subjectRef) return '—';
        if (row.subjectKind === 'task') return <Link className="row-link" href={`/tasks/${row.subjectRef}`}>{t.openTask}</Link>;
        return <bdi dir="ltr">{row.subjectRef}</bdi>;
      },
    },
    { key: 'ip', header: t.activityIp, render: (row) => (row.ip ? <bdi dir="ltr">{row.ip.replace(/^::ffff:/, '')}</bdi> : '—') },
  ];

  function clear() {
    setAction('');
    setResult('');
    setLayer('');
    setQ('');
    setFrom('');
    setTo('');
  }

  return (
    <Desk title={t.navAudit} lede="" error={list.error} note="">
      <FilterBar onClear={clear} clearLabel={t.clearFilters}>
        <label>
          {t.kind}
          <select value={action} onChange={(event) => setAction(event.target.value)}>
            <option value="">{t.allRows}</option>
            {ACTIONS.map((value) => (
              <option key={value} value={value}>{actionName(t, value)}</option>
            ))}
          </select>
        </label>
        <label>
          {t.activityResult}
          <select value={result} onChange={(event) => setResult(event.target.value)}>
            <option value="">{t.allRows}</option>
            <option value="ok">{t.activitySuccess}</option>
            <option value="fail">{t.activityFailure}</option>
          </select>
        </label>
        <label>
          {t.layer}
          <select value={layer} onChange={(event) => setLayer(event.target.value)}>
            <option value="">{t.allRows}</option>
            {LAYERS.map((value) => (
              <option key={value} value={value}>{layerName(t, value)}</option>
            ))}
          </select>
        </label>
        <label>
          {t.activitySearch}
          <input value={q} onChange={(event) => setQ(event.target.value)} />
        </label>
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
        <PagedTable list={list} columns={columns} rowKey={(row) => row.id} empty={t.noMovements} keepHead skeleton={{ rows: 6, columns: 8 }} />
      </section>
    </Desk>
  );
}
