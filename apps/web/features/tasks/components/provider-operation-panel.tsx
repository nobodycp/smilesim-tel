'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AccountName } from '../../../components/account-name';
import { Alert } from '../../../components/alert';
import { Money, latinWhen } from '../../../components/desk';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/cn';
import { api } from '../../../lib/api';
import type { ProviderDecision, ProviderDecisionAnswer, TaskDetail } from '../../../lib/api-types';
import { usePrefs } from '../../../lib/prefs';
import { sharedKeys } from '../../../lib/query';
import { holdTone, operationTone } from '../../../lib/status-tone';
import { useApiQuery } from '../../../lib/use-api-query';
import { decisionName, holdName, phaseHint, phaseName, reasonName, stepVerb } from '../provider-operation-names';
import { DecisionDialog } from './decision-dialog';
import { Evidence, ProposalCard, decisionActionsClass, decisionHintClass, stepLineClass } from './proposal-card';

/*
 * The panel's look (ADR 0022): a column 8px apart, 14px padding, ruled off from the facts under it by a 1px `--rd-line`; its head a wrapping row 8px apart,
 * the title (12px bold, no margin) at the start and the phase at the end; the hint 12px `--rd-ink-2` at 1.6; the facts
 * a column 4px apart, each a wrapping row 8px apart with the name (11px bold `--rd-muted`) at the start and the value
 * (12px semibold) at the end, the held amount and its badge an inline row 8px apart; the decisions a column 8px apart
 * under a dashed `--rd-line` rule 8px above, their titles 11px bold `--rd-muted`; the record a fold whose summary is
 * 11px bold `--rd-muted`, its list a column 8px apart, 8px under the summary, each step a column 2px apart behind a
 * 2px `--rd-line` edge at the reading start, 10px in; a step's verb semibold, its time `--rd-muted`.
 */
const SECTION_TITLE = 'm-0 text-xs font-bold text-muted';
const HINT = 'm-0 text-sm leading-1-6 text-ink-2';
const FACT = 'flex flex-wrap items-center justify-between gap-2';
const FACT_NAME = 'text-xs font-bold text-muted';
const FACT_VALUE = 'm-0 text-sm font-semibold';

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
    <section className="grid gap-2 border-b border-line p-3.5" aria-label={t.poTitle} data-phase={operation.phase}>
      <header className="flex flex-wrap items-center justify-between gap-2" data-testid="po-head">
        <h2 className="m-0 text-sm font-bold">{t.poTitle}</h2>
        <Badge variant={operationTone(operation.phase)} dot>{phaseName(t, operation.phase)}</Badge>
      </header>
      <p className={HINT} data-testid="po-hint">{phaseHint(t, operation.phase)}</p>
      <dl className="m-0 grid gap-1">
        {operation.reason ? (
          <div className={FACT}><dt className={FACT_NAME}>{t.poReason}</dt><dd className={FACT_VALUE}>{reasonName(t, operation.reason)}</dd></div>
        ) : null}
        {task.hold && task.hold !== 'none' ? (
          <div className={FACT}>
            <dt className={FACT_NAME}>{t.poHold}</dt>
            <dd className={cn(FACT_VALUE, 'inline-flex flex-wrap items-center gap-2')} data-testid="po-money"><Money value={Math.abs(task.posDelta)} /><Badge variant={holdTone(task.hold)}>{holdName(t, task.hold)}</Badge></dd>
          </div>
        ) : null}
      </dl>

      {operation.decisions ? (
        <div className="grid gap-2 border-0 border-t border-dashed border-line pt-2" data-testid="po-decisions">
          <Alert>{view.error}</Alert>
          {!view.loaded ? <p className={decisionHintClass} aria-busy="true">…</p> : null}
          {standing ? (
            <>
              {standing.proposal ? (
                <>
                  <h3 className={SECTION_TITLE}>{t.propOpen}</h3>
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
                  <h3 className={SECTION_TITLE}>{t.decSection}</h3>
                  <div className={decisionActionsClass}>
                    {standing.decisions.map((decision) => (
                      <Button key={decision} type="button" size="sm" variant={decision === 'confirm-success' || decision === 'apply-corrected' ? 'primary' : 'secondary'} onClick={() => setForm(decision)}>
                        {decisionName(t, decision)}
                      </Button>
                    ))}
                  </div>
                </>
              ) : null}
              {!standing.proposal && standing.blocked === 'own-task' ? <p className={decisionHintClass}>{t.propOwnTask}</p> : null}
              <details data-testid="po-history" open={standing.history.length > 0 && standing.history.length <= 3}>
                <summary className="cursor-pointer text-xs font-bold text-muted">{t.decHistory} <bdi dir="ltr">({standing.history.length})</bdi></summary>
                {standing.history.length === 0 ? <p className={decisionHintClass}>{t.decNoHistory}</p> : (
                  <ol className="m-0 mt-2 grid list-none gap-2 p-0">
                    {standing.history.map((record) => (
                      <li key={record.sequence} className="grid gap-0.5 border-s-2 border-line ps-2.5">
                        <p className={stepLineClass}>
                          <AccountName login={record.accountLoginName} />
                          <span className="font-semibold">{stepVerb(t, record.type)} «{decisionName(t, record.decision)}»</span>
                          <bdi dir="ltr" className="text-muted">{latinWhen(record.at)}</bdi>
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
