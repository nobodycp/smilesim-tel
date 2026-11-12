'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { AccountName } from '../../../components/account-name';
import { Desk, Money, actionName, latinWhen } from '../../../components/desk';
import { EmptyState } from '../../../components/empty-state';
import { TableSkeleton } from '../../../components/loading';
import { Badge } from '../../../components/ui/badge';
import { buttonClass } from '../../../components/ui/button';
import { api } from '../../../lib/api';
import type { WaitingDecision } from '../../../lib/api-types';
import { useCrumbs } from '../../../lib/crumbs';
import { usePageTitle } from '../../../lib/page-title';
import { usePrefs } from '../../../lib/prefs';
import { sharedKeys } from '../../../lib/query';
import { operationTone } from '../../../lib/status-tone';
import { useApiQuery } from '../../../lib/use-api-query';
import { ProposalCard } from '../components/proposal-card';
import { decisionName, phaseName, reasonName } from '../provider-operation-names';

/**
 * The operations that wait for a person (spec 2026-11-12-provider-operation-screens, 4): proposals a second
 * account must answer, then the ones nobody has decided on yet. The list is the API's answer for this account,
 * as it is: nothing is filtered here, and a row carries no eSIM code. A decision itself is stated on the task.
 */
export function ProviderDecisionsScreen() {
  const { t } = usePrefs();
  const client = useQueryClient();
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  usePageTitle(t.decQueueTitle);
  useCrumbs({ '/tasks/decisions': t.decQueueTitle });
  const list = useApiQuery(sharedKeys.providerDecisions, () => api.providerDecisions(), { fresh: true });
  const items = list.data?.items ?? [];
  const proposals = items.filter((item) => item.proposal);
  const undecided = items.filter((item) => !item.proposal);

  const refresh = async (taskId: string) => {
    await Promise.all([list.reload(), client.invalidateQueries({ queryKey: sharedKeys.task(taskId) })]);
  };

  const row = (item: WaitingDecision) => (
    <li key={item.taskId} className="po-row" data-phase={item.phase ?? ''}>
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
    </li>
  );

  return (
    <Desk title={t.decQueueTitle} lede={t.decQueueLede} error={error || list.error} note={note}>
      {!list.loaded ? (
        <section className="pane"><TableSkeleton rows={4} columns={2} /></section>
      ) : items.length === 0 && !list.error ? (
        <section className="pane"><EmptyState text={t.decQueueEmptyHint}>{t.decQueueEmpty}</EmptyState></section>
      ) : (
        <>
          {list.data?.capped ? <p className="hint">{t.decQueueCapped}</p> : null}
          {proposals.length > 0 ? (
            <section className="pane po-queue" aria-label={t.decQueueProposals}>
              <header className="pane-head"><h2>{t.decQueueProposals} <bdi dir="ltr">({proposals.length})</bdi></h2></header>
              <ul className="po-list">{proposals.map(row)}</ul>
            </section>
          ) : null}
          {undecided.length > 0 ? (
            <section className="pane po-queue" aria-label={t.decQueueUndecided}>
              <header className="pane-head"><h2>{t.decQueueUndecided} <bdi dir="ltr">({undecided.length})</bdi></h2></header>
              <ul className="po-list">{undecided.map(row)}</ul>
            </section>
          ) : null}
        </>
      )}
    </Desk>
  );
}
