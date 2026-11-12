'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AccountName } from '../../../components/account-name';
import { Money, latinWhen } from '../../../components/desk';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { api } from '../../../lib/api';
import type { ProviderDecision, ProviderDecisionAnswer, TaskDetail } from '../../../lib/api-types';
import { usePrefs } from '../../../lib/prefs';
import { sharedKeys } from '../../../lib/query';
import { holdTone, operationTone } from '../../../lib/status-tone';
import { useApiQuery } from '../../../lib/use-api-query';
import { decisionName, holdName, phaseHint, phaseName, reasonName, stepVerb } from '../provider-operation-names';
import { DecisionDialog } from './decision-dialog';
import { Evidence, ProposalCard } from './proposal-card';

/**
 * A task's provider operation on its ticket (spec 2026-11-12-provider-operation-screens, 2 and 3): where it
 * stands, what became of the held amount, and, for an account the API lets read it, the decisions: the proposal
 * that is open, what this account may state, and the record. Everything offered here comes from the API's own
 * answer; the routes judge each request again.
 */
export function ProviderOperationPanel({ task, onChanged, say }: { task: TaskDetail; onChanged: () => Promise<unknown>; say: (message: { error?: string; note?: string }) => void }) {
  const { t } = usePrefs();
  const client = useQueryClient();
  const operation = task.operation ?? null;
  const [form, setForm] = useState<ProviderDecision | null>(null);
  // `fresh`: the evidence of a decision is not kept once the ticket closes.
  const view = useApiQuery(sharedKeys.taskDecision(task.id), () => api.providerDecisionView(task.id), { enabled: Boolean(operation?.decisions), fresh: true });
  if (!operation) return null;

  /** After any write, or a refusal that says the screen is stale: the task, its decisions and the queue are asked again. */
  const refresh = async () => {
    setForm(null);
    await Promise.all([onChanged(), view.reload(), client.invalidateQueries({ queryKey: sharedKeys.providerDecisions })]);
  };
  const decided = (answer: ProviderDecisionAnswer) => {
    say({ note: answer.outcome === 'applied' ? t.decApplied : answer.outcome === 'proposed' ? t.decProposed : t.decExceptionNote });
    void refresh();
  };
  const stale = (message: string) => {
    say({ error: `${message}. ${t.decChanged}` });
    void refresh();
  };
  const standing = view.data;

  return (
    <section className="po-panel" aria-label={t.poTitle} data-phase={operation.phase}>
      <header className="po-head">
        <h2>{t.poTitle}</h2>
        <Badge variant={operationTone(operation.phase)} dot>{phaseName(t, operation.phase)}</Badge>
      </header>
      <p className="po-hint">{phaseHint(t, operation.phase)}</p>
      <dl className="po-facts">
        {operation.reason ? (
          <div><dt>{t.poReason}</dt><dd>{reasonName(t, operation.reason)}</dd></div>
        ) : null}
        {task.hold && task.hold !== 'none' ? (
          <div>
            <dt>{t.poHold}</dt>
            <dd className="po-money"><Money value={Math.abs(task.posDelta)} /><Badge variant={holdTone(task.hold)}>{holdName(t, task.hold)}</Badge></dd>
          </div>
        ) : null}
      </dl>

      {operation.decisions ? (
        <div className="po-decisions">
          {view.error ? <p className="error" role="alert">{view.error}</p> : null}
          {!view.loaded ? <p className="hint" aria-busy="true">…</p> : null}
          {standing ? (
            <>
              {standing.proposal ? (
                <>
                  <h3>{t.propOpen}</h3>
                  <ProposalCard
                    standing={standing}
                    answer={(approve) => api.answerProviderDecision(task.id, approve)}
                    onDone={(answer) => {
                      say({ note: answer.outcome === 'approved' ? t.decApproved : t.decRefused });
                      void refresh();
                    }}
                    onStale={stale}
                  />
                </>
              ) : null}
              {standing.decisions.length > 0 ? (
                <>
                  <h3>{t.decSection}</h3>
                  <div className="po-actions">
                    {standing.decisions.map((decision) => (
                      <Button key={decision} type="button" size="sm" variant={decision === 'confirm-success' || decision === 'apply-corrected' ? 'primary' : 'secondary'} onClick={() => setForm(decision)}>
                        {decisionName(t, decision)}
                      </Button>
                    ))}
                  </div>
                </>
              ) : null}
              {!standing.proposal && standing.blocked === 'own-task' ? <p className="hint">{t.propOwnTask}</p> : null}
              <details className="po-history" open={standing.history.length > 0 && standing.history.length <= 3}>
                <summary>{t.decHistory} <bdi dir="ltr">({standing.history.length})</bdi></summary>
                {standing.history.length === 0 ? <p className="hint">{t.decNoHistory}</p> : (
                  <ol>
                    {standing.history.map((record) => (
                      <li key={record.sequence}>
                        <p className="po-step">
                          <AccountName login={record.accountLoginName} />
                          <span>{stepVerb(t, record.type)} «{decisionName(t, record.decision)}»</span>
                          <bdi dir="ltr">{latinWhen(record.at)}</bdi>
                        </p>
                        <Evidence record={record} />
                      </li>
                    ))}
                  </ol>
                )}
              </details>
              {form ? (
                <DecisionDialog
                  decision={form}
                  needs={standing.needs}
                  send={(body) => api.decideProviderOperation(task.id, body)}
                  onClose={() => setForm(null)}
                  onDone={decided}
                  onStale={stale}
                />
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
