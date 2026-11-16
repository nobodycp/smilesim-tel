'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { AccountName } from '../../../components/account-name';
import { PagedTable, type Column } from '../../../components/data-table';
import { Desk, Money, Pane, actionName, taskStatus } from '../../../components/desk';
import { FilterBar } from '../../../components/filter-bar';
import { RowMenu } from '../../../components/row-menu';
import { TableSearch } from '../../../components/table-search';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Tabs } from '../../../components/tabs';
import { Zap } from 'lucide-react';
import { Select, SelectItem } from '../../../components/ui/select';
import { NameField } from '../../../components/name-field';
import { cn } from '../../../lib/cn';
import { useApiQuery } from '../../../lib/use-api-query';
import { sharedKeys } from '../../../lib/query';
import { api, type PackageRow, type TaskRow } from '../../../lib/api';
import { usePrefs } from '../../../lib/prefs';
import { useAction } from '../../../lib/use-action';
import { pick } from '../../../lib/fetched';
import { pageRows, usePaged } from '../../../lib/use-paged';
import { useDebouncedField, useUrlFilters } from '../../../lib/url-state';
import { operationTone, taskTone } from '../../../lib/status-tone';
import { useDesk } from '../../../lib/desk-session';
import { phaseName } from '../provider-operation-names';

// One empty list for every render, so the memos below keep their inputs while the catalog loads.
const NO_PACKAGES: PackageRow[] = [];
const TASK_ACTIONS = ['activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch', 'sim'] as const;

const FILTER_KEYS = ['q', 'status', 'action', 'pack', 'company', 'provider'] as const;
const TASK_STATUSES = ['working', 'done', 'cancelled'];

/*
 * The tasks list as card rows (Tailwind migration T4.6, ADR 0022), ported from graphite.css "Tasks as card rows":
 * - the list's card: `Pane`; its table head is for screen readers only (taken out of the flow, 1px, clipped, one line);
 * - a row's card (the link): a row 14px apart, the text's own colour, no underline; under the pointer the operation's
 *   name turns `--rd-accent`;
 * - the mark: 36px, 6px corners, `--rd-accent` on its soft fill, an 8px cut corner at the top inline end;
 * - the text: a column 3px apart that may shrink; the title a wrapping row 10px apart (the operation 14px bold ink,
 *   then its badges); the meta a wrapping row 6px apart, 12px `--rd-muted`: the number semibold `--rd-ink-2` at
 *   0.03em, the last note at most 24rem, cut with an ellipsis;
 * - the actions cell: an inline row 6px apart.
 * The filter chips stay plain `<label>` children of FilterBar (its chip rules read the panel's slot, not a class).
 */
const LIST_PANE = cn(
  '[&_[data-slot=table]_thead]:absolute [&_[data-slot=table]_thead]:size-px [&_[data-slot=table]_thead]:overflow-hidden',
  '[&_[data-slot=table]_thead]:[clip:rect(0_0_0_0)] [&_[data-slot=table]_thead]:whitespace-nowrap',
);
const TASK_MARK = cn(
  'grid size-9 flex-none place-items-center rounded-sm bg-accent-soft text-accent',
  '[clip-path:polygon(0_0,calc(100%_-_8px)_0,100%_8px,100%_100%,0_100%)] rtl:[clip-path:polygon(8px_0,100%_0,100%_100%,0_100%,0_8px)]',
);

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
  const catalog = useApiQuery(sharedKeys.packages, () => api.packages());
  const packages = catalog.data?.packages ?? NO_PACKAGES;
  const list = usePaged<TaskRow>(
    `${needle}|${status}|${action}|${pack}|${company}|${provider}`,
    async (cursor) =>
      pick(
        await api.tasks({
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
  const { me } = useDesk();
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
  const counts = useApiQuery(sharedKeys.overview('all'), () => api.overview('all')).data?.tasks;
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
      // A line number cell that reads as a card: the whole width, regular weight, no letter spacing.
      kind: 'msisdn',
      cell: 'w-full font-normal tracking-normal',
      render: (row) => (
        <Link className="group/task flex items-center gap-3.5 text-inherit no-underline" data-testid="task-card" href={`/tasks/${row.id}`}>
          <span className={TASK_MARK} aria-hidden="true"><Zap size={18} strokeWidth={1.9} /></span>
          <span className="grid min-w-0 gap-0.75">
            <span className="flex flex-wrap items-center gap-2.5">
              <b className="text-base font-bold text-ink group-hover/task:text-accent">{actionName(t, row.action)}</b>
              <Badge variant={taskTone(row.status)} dot>{taskStatus(t, row.status)}</Badge>
              {/* Where its provider operation stands, while the task is open: waiting, unconfirmed, an exception. */}
              {row.operationPhase && row.status === 'working' ? <Badge variant={operationTone(row.operationPhase)}>{phaseName(t, row.operationPhase)}</Badge> : null}
            </span>
            <span className="flex flex-wrap gap-1.5 text-sm text-muted">
              {row.msisdn ? <bdi dir="ltr" className="font-semibold tracking-[0.03em] text-ink-2">{row.msisdn}</bdi> : null}
              {[row.companyName, row.packageName].filter(Boolean).map((part) => <span key={part}>· {part}</span>)}
              <span>· <AccountName login={row.posLoginName} /></span>
              {row.lastNote ? <span className="max-w-96 overflow-hidden text-ellipsis">· {row.lastNote}</span> : null}
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
          <span className="inline-flex items-center gap-1.5">
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
        <Button asChild variant="secondary">
          <Link href="/tasks/decisions">
            {t.decQueueLink}
            {/* The count is the API's total of the whole queue, not the size of the page it answered. */}
            {waiting.data && waiting.data.total > 0 ? <Badge variant="warning">{waiting.data.total}</Badge> : null}
          </Link>
        </Button>
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
          <Select value={action} onValueChange={(next) => setFilters({ action: next })}>
            <SelectItem value="">{t.allRows}</SelectItem>
            {TASK_ACTIONS.map((code) => (
              <SelectItem key={code} value={code}>
                {actionName(t, code)}
              </SelectItem>
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
      <Pane className={LIST_PANE}>
        <PagedTable list={list} columns={columns} rowKey={(row) => row.id} empty={t.noTasks} skeleton={{ rows: 5, columns: 3 }} cards={false} cellClassName="h-16" />
      </Pane>
    </Desk>
  );
}
