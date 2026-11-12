'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { AccountName } from '../../../components/account-name';
import { Desk, Money, actionName, latinWhen } from '../../../components/desk';
import { PagedTable, type Column } from '../../../components/data-table';
import { Tabs } from '../../../components/tabs';
import { Badge } from '../../../components/ui/badge';
import { buttonClass } from '../../../components/ui/button';
import { api } from '../../../lib/api';
import type { WaitingDecision } from '../../../lib/api-types';
import { useCrumbs } from '../../../lib/crumbs';
import { usePageTitle } from '../../../lib/page-title';
import { usePrefs } from '../../../lib/prefs';
import { sharedKeys } from '../../../lib/query';
import { operationTone } from '../../../lib/status-tone';
import { pick } from '../../../lib/fetched';
import { pageRows, usePaged } from '../../../lib/use-paged';
import { useUrlFilters } from '../../../lib/url-state';
import { ProposalCard } from '../components/proposal-card';
import { decisionName, phaseName, reasonName } from '../provider-operation-names';

/** The queue's two parts, as the API names them (`?waiting=`). */
type Waiting = 'approval' | 'decision';

/**
 * The operations that wait for a person (spec 2026-11-12-provider-operation-screens, 4): in one tab the proposals a
 * second account must answer, in the other the ones nobody has decided on yet. Each tab is a list the API pages
 * (`usePaged`, as every list of the office): the rows are the API's answer for this account as it is, nothing is
 * filtered here, and the counts on the tabs are the API's totals of the whole queue. A row carries no eSIM code.
 * A decision itself is stated on the task.
 */
export function ProviderDecisionsScreen() {
  const { t } = usePrefs();
  const client = useQueryClient();
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  usePageTitle(t.decQueueTitle);
  useCrumbs({ '/tasks/decisions': t.decQueueTitle });
  // The tab lives in the address, so a link and the back button keep it.
  const [filters, setFilters] = useUrlFilters(['waiting'] as const);
  const waiting: Waiting = filters.waiting === 'decision' ? 'decision' : 'approval';
  const list = usePaged<WaitingDecision, { approval: number; decision: number }>(waiting, async (cursor) =>
    pick(await api.providerDecisions({ waiting, cursor }), (data) => ({ ...pageRows(data), extra: data.totals })));
  const totals = list.extra;

  const refresh = async (taskId: string) => {
    await Promise.all([list.reload(), client.invalidateQueries({ queryKey: sharedKeys.providerDecisions }), client.invalidateQueries({ queryKey: sharedKeys.task(taskId) })]);
  };

  const columns: Column<WaitingDecision>[] = [
    {
      key: 'operation',
      header: t.poTitle,
      cell: 'po-cell',
      render: (item) => (
        <div className="po-row" data-phase={item.phase ?? ''}>
          <div className="po-row-head">
            <b>{actionName(t, item.action)}</b>
            {item.phase ? <Badge variant={operationTone(item.phase)} dot>{phaseName(t, item.phase)}</Badge> : null}
            {item.reason ? <span className="po-row-reason">{reasonName(t, item.reason)}</span> : null}
            <Link className={`${buttonClass({ variant: 'secondary', size: 'sm' })} po-row-open`} href={`/tasks/${encodeURIComponent(item.taskId)}`}>{t.openTask}</Link>
          </div>
          <p className="po-row-meta">
            {item.msisdn ? <bdi dir="ltr">{item.msisdn}</bdi> : null}
            {item.packageName ? <span>{item.packageName}</span> : null}
            <span>{t.pointOfSale}: <AccountName login={item.posLoginName} /></span>
            <span>{t.taskSubmitter}: <AccountName login={item.submitterLoginName} /></span>
            <span>{t.decHeldAmount}: <Money value={item.held} /></span>
            <span>{t.decWaitingSince} <bdi dir="ltr">{latinWhen(item.waitingSince)}</bdi></span>
          </p>
          {item.proposal ? (
            <ProposalCard
              standing={item}
              answer={(approve) => api.answerProviderDecision(item.taskId, approve)}
              onDone={(answer) => {
                setError('');
                setNote(answer.outcome === 'approved' ? t.decApproved : t.decRefused);
                void refresh(item.taskId);
              }}
              onStale={(message) => {
                setNote('');
                setError(`${message}. ${t.decChanged}`);
                void refresh(item.taskId);
              }}
            />
          ) : (
            <p className="po-row-next">
              {item.blocked === 'own-task' ? t.propOwnTask : item.decisions.map((decision) => decisionName(t, decision)).join(' · ')}
            </p>
          )}
        </div>
      ),
    },
  ];

  return (
    <Desk title={t.decQueueTitle} lede={t.decQueueLede} error={error} note={note}>
      <Tabs
        label={t.decQueueTitle}
        value={waiting}
        onChange={(next) => setFilters({ waiting: next === 'approval' ? '' : next })}
        items={[
          { key: 'approval', label: t.decQueueProposals, count: totals?.approval },
          { key: 'decision', label: t.decQueueUndecided, count: totals?.decision },
        ]}
      />
      <section className="pane po-queue" aria-label={waiting === 'approval' ? t.decQueueProposals : t.decQueueUndecided}>
        <PagedTable list={list} columns={columns} rowKey={(item) => item.taskId} empty={t.decQueueEmpty} skeleton={{ rows: 4, columns: 1 }} />
      </section>
    </Desk>
  );
}
