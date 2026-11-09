'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { AccountName } from '../../../components/account-name';
import { PagedTable, type Column } from '../../../components/data-table';
import { Desk, Money, actionName, taskStatus } from '../../../components/desk';
import { FilterBar } from '../../../components/filter-bar';
import { RowMenu } from '../../../components/row-menu';
import { TableSearch } from '../../../components/table-search';
import { Badge } from '../../../components/ui/badge';
import { Select } from '../../../components/ui/select';
import { useApiQuery } from '../../../lib/use-api-query';
import { sharedKeys } from '../../../lib/query';
import { api, type PackageRow, type TaskRow } from '../../../lib/api';
import { usePrefs } from '../../../lib/prefs';
import { useAction } from '../../../lib/use-action';
import { pick } from '../../../lib/fetched';
import { usePaged } from '../../../lib/use-paged';
import { useDebouncedField, useUrlFilters } from '../../../lib/url-state';
import { taskTone } from '../../../lib/status-tone';

// One empty list for every render, so the memos below keep their inputs while the catalog loads.
const NO_PACKAGES: PackageRow[] = [];
const TASK_ACTIONS = ['activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch', 'sim'] as const;

const FILTER_KEYS = ['q', 'status', 'action', 'pack', 'company', 'provider'] as const;
const TASK_STATUSES = ['working', 'done', 'cancelled'];

export function TasksScreen() {
  const { t } = usePrefs();
  const router = useRouter();
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  // The filters live in the address (`?status=pending&q=…`), so back/forward and links keep them.
  const [filters, setFilters] = useUrlFilters(FILTER_KEYS);
  const { q: needle, action, pack, company, provider } = filters;
  const status = TASK_STATUSES.includes(filters.status) ? filters.status : '';
  const commitQuery = useCallback((value: string) => setFilters({ q: value }), [setFilters]);
  const [query, setQuery] = useDebouncedField(needle, commitQuery);
  const catalog = useApiQuery(sharedKeys.packages, () => api.officePackages());
  const packages = catalog.data?.packages ?? NO_PACKAGES;
  const list = usePaged<TaskRow>(
    `${needle}|${status}|${action}|${pack}|${company}|${provider}`,
    async (cursor) =>
      pick(
        await api.officeTasks({
          q: needle,
          status,
          action,
          packageCode: pack,
          company,
          provider,
          cursor,
        }),
        (data) => ({ rows: data.tasks, next: data.nextCursor, total: data.total }),
      ),
  );
  const { run } = useAction({ setError, setNote, onDone: list.reload });

  const companyOptions = useMemo(() => {
    const names = new Set(packages.map((row) => row.companyName).filter(Boolean));
    return [...names].sort((left, right) => left.localeCompare(right));
  }, [packages]);

  const providerOptions = useMemo(() => {
    const names = new Set(packages.map((row) => row.providerName).filter(Boolean));
    return [...names].sort((left, right) => left.localeCompare(right));
  }, [packages]);

  const packageOptions = useMemo(() => {
    return packages
      .filter((row) => (!company || row.companyName === company) && (!provider || row.providerName === provider))
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [packages, company, provider]);

  const columns: Column<TaskRow>[] = [
    {
      key: 'number',
      header: t.number,
      cell: 'msisdn',
      render: (row) =>
        row.msisdn ? (
          <Link href={`/tasks/${row.id}`}>
            <bdi dir="ltr">{row.msisdn}</bdi>
          </Link>
        ) : (
          '—'
        ),
    },
    {
      key: 'status',
      header: t.status,
      render: (row) => (
        <Badge variant={taskTone(row.status)} dot>
          {taskStatus(t, row.status)}
        </Badge>
      ),
    },
    {
      key: 'movement',
      header: t.movement,
      render: (row) => <Link href={`/tasks/${row.id}`}>{actionName(t, row.action)}</Link>,
    },
    { key: 'package', header: t.packageName, render: (row) => row.packageName || '—' },
    { key: 'company', header: t.company, render: (row) => row.companyName || '—' },
    { key: 'provider', header: t.provider, render: (row) => row.providerName || '—' },
    { key: 'pos', header: t.pointOfSale, render: (row) => <AccountName login={row.posLogin} /> },
    { key: 'amount', header: t.amount, num: true, render: (row) => <Money value={row.posDelta} /> },
    {
      key: 'note',
      header: t.note,
      render: (row) => row.lastNote || '—',
    },
    {
      key: 'ops',
      header: t.rowActions,
      actions: true,
      render: (row) => {
        const items = [
          { label: t.openTask, icon: 'enter' as const, onClick: () => router.push(`/tasks/${row.id}`) },
          ...(row.canTake ? [{ label: t.take, icon: 'enter' as const, onClick: () => run(() => api.takeTask(row.id), { note: t.take }) }] : []),
          ...(row.canCancel ? [{ label: t.cancelTask, icon: 'ban' as const, danger: true, onClick: () => run(() => api.cancelTask(row.id), { note: t.cancelTask }) }] : []),
        ];
        return <RowMenu label={`${t.rowActions} ${row.msisdn ?? row.id}`} items={items} />;
      },
    },
  ];

  return (
    <Desk title={t.tasksTitle} lede="" error={error || catalog.error} note={note}>
      <FilterBar
        onClear={() => setFilters({ q: '', status: '', action: '', pack: '', company: '', provider: '' })}
        clearLabel={t.clearFilters}
      >
        <TableSearch label={t.numberSearch} value={query} onChange={setQuery} />
        <label>
          {t.movement}
          <Select value={action} onChange={(event) => setFilters({ action: event.target.value })}>
            <option value="">{t.allRows}</option>
            {TASK_ACTIONS.map((code) => (
              <option key={code} value={code}>
                {actionName(t, code)}
              </option>
            ))}
          </Select>
        </label>
        <label>
          {t.packageName}
          <Select value={pack} onChange={(event) => setFilters({ pack: event.target.value })}>
            <option value="">{t.allRows}</option>
            {packageOptions.map((row) => (
              <option key={row.code} value={row.code}>
                {row.name}
              </option>
            ))}
          </Select>
        </label>
        <label>
          {t.provider}
          <Select
            value={provider}
            onChange={(event) => setFilters({ provider: event.target.value, pack: '' })}
          >
            <option value="">{t.allRows}</option>
            {providerOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </label>
        <label>
          {t.company}
          <Select
            value={company}
            onChange={(event) => setFilters({ company: event.target.value, pack: '' })}
          >
            <option value="">{t.allRows}</option>
            {companyOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </label>
        <label>
          {t.status}
          <Select value={status} onChange={(event) => setFilters({ status: event.target.value })}>
            <option value="">{t.allRows}</option>
            <option value="working">{taskStatus(t, 'working')}</option>
            <option value="done">{taskStatus(t, 'done')}</option>
            <option value="cancelled">{taskStatus(t, 'cancelled')}</option>
          </Select>
        </label>
      </FilterBar>
      <section className="pane">
        <PagedTable list={list} columns={columns} rowKey={(row) => row.id} empty={t.noTasks} skeleton={{ rows: 5, columns: 8 }} />
      </section>
    </Desk>
  );
}
