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
import { Button, buttonClass } from '../../../components/ui/button';
import { Tabs } from '../../../components/tabs';
import { Zap } from 'lucide-react';
import { Select } from '../../../components/ui/select';
import { NameField } from '../../../components/name-field';
import { useApiQuery } from '../../../lib/use-api-query';
import { sharedKeys } from '../../../lib/query';
import { api, type PackageRow, type TaskRow } from '../../../lib/api';
import { usePrefs } from '../../../lib/prefs';
import { useAction } from '../../../lib/use-action';
import { pick } from '../../../lib/fetched';
import { pageRows, usePaged } from '../../../lib/use-paged';
import { useDebouncedField, useUrlFilters } from '../../../lib/url-state';
import { operationTone, taskTone } from '../../../lib/status-tone';
import { useOffice } from '../../../lib/office-session';
import { phaseName } from '../provider-operation-names';

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
        pageRows,
      ),
  );
  const { run } = useAction({ setError, setNote, onDone: list.reload });
  // Who is shown the way to the provider decisions: the owner or a branch account holding `accounting`, in a
  // session of its own. The API decides who reads them; this only spares the others a link that would refuse.
  const { me } = useOffice();
  const mayDecide = Boolean(me && me.layer === 'branch' && !me.impersonating && (me.isBranchOwner || me.grants.includes('accounting')));
  const waiting = useApiQuery(sharedKeys.providerDecisions, () => api.providerDecisions(), { enabled: mayDecide, fresh: true });

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

  // The status tabs (Graphite): all, in progress, done, closed — with the counts of the whole picture.
  const counts = useApiQuery(sharedKeys.overview('all'), () => api.officeOverview('all')).data?.tasks;
  const tabs: { key: string; label: string; count?: number }[] = [
    { key: '', label: t.tasksAllTab },
    { key: 'working', label: taskStatus(t, 'working'), count: counts ? counts.pending + counts.working : undefined },
    { key: 'done', label: taskStatus(t, 'done'), count: counts?.done },
    { key: 'cancelled', label: taskStatus(t, 'cancelled'), count: counts ? counts.rejected + counts.cancelled : undefined },
  ];

  // Each task is one card row, as in the approved design: the operation's mark, its name and status, the number with
  // its company, package and point of sale under it; the amount; then take or open, and the rest in ⋯.
  const columns: Column<TaskRow>[] = [
    {
      key: 'task',
      header: t.tasksTitle,
      cell: 'msisdn task-cell',
      render: (row) => (
        <Link className="task-card" href={`/tasks/${row.id}`}>
          <span className="task-mark" aria-hidden="true"><Zap size={18} strokeWidth={1.9} /></span>
          <span className="task-main">
            <span className="task-title">
              <b>{actionName(t, row.action)}</b>
              <Badge variant={taskTone(row.status)} dot>{taskStatus(t, row.status)}</Badge>
              {/* Where its provider operation stands, while the task is open: waiting, unconfirmed, an exception. */}
              {row.operationPhase && row.status === 'working' ? <Badge variant={operationTone(row.operationPhase)}>{phaseName(t, row.operationPhase)}</Badge> : null}
            </span>
            <span className="task-meta">
              {row.msisdn ? <bdi dir="ltr" className="task-msisdn">{row.msisdn}</bdi> : null}
              {[row.companyName, row.packageName].filter(Boolean).map((part) => <span key={part}>· {part}</span>)}
              <span>· <AccountName login={row.posLoginName} /></span>
              {row.lastNote ? <span className="task-note">· {row.lastNote}</span> : null}
            </span>
          </span>
        </Link>
      ),
    },
    { key: 'amount', header: t.amount, num: true, render: (row) => <Money value={row.posDelta} /> },
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
        return (
          <span className="task-act">
            {/* The row opens the ticket; only «أخذ المهمة» earns a button of its own (as in the design). */}
            {row.canTake ? (
              <Button type="button" size="sm" onClick={() => run(() => api.takeTask(row.id), { note: t.take })}>{t.take}</Button>
            ) : null}
            <RowMenu label={`${t.rowActions} ${row.msisdn ?? row.id}`} items={items} />
          </span>
        );
      },
    },
  ];

  return (
    <Desk
      title={t.tasksTitle}
      lede={t.tasksLede}
      error={error || catalog.error}
      note={note}
      action={mayDecide ? (
        // The queue of provider decisions, for the accounts the API lets read it (it refuses everyone else).
        <Link className={buttonClass({ variant: 'secondary' })} href="/tasks/decisions">
          {t.decQueueLink}
          {/* The count is the API's total of the whole queue, not the size of the page it answered. */}
          {waiting.data && waiting.data.total > 0 ? <Badge variant="warning">{waiting.data.total}</Badge> : null}
        </Link>
      ) : undefined}
    >
      <Tabs label={t.status} items={tabs} value={status} onChange={(next) => setFilters({ status: next })} />
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
          <NameField value={pack} allLabel={t.allRows} onChange={(next) => setFilters({ pack: next })} options={packageOptions.map((row) => ({ value: row.code, label: row.name, hint: [row.companyName, row.providerName].filter(Boolean).join(' · '), keys: [row.code] }))} />
        </label>
        <label>
          {t.provider}
          <NameField value={provider} allLabel={t.allRows} onChange={(next) => setFilters({ provider: next, pack: '' })} options={providerOptions.map((name) => ({ value: name, label: name }))} />
        </label>
        <label>
          {t.company}
          <NameField value={company} allLabel={t.allRows} onChange={(next) => setFilters({ company: next, pack: '' })} options={companyOptions.map((name) => ({ value: name, label: name }))} />
        </label>
      </FilterBar>
      <section className="pane task-list">
        <PagedTable list={list} columns={columns} rowKey={(row) => row.id} empty={t.noTasks} skeleton={{ rows: 5, columns: 3 }} />
      </section>
    </Desk>
  );
}
