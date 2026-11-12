'use client';

import { useState } from 'react';
import { AccountName } from '../../../components/account-name';
import { latinWhen } from '../../../components/desk';
import { Dialog } from '../../../components/dialog';
import { Button } from '../../../components/ui/button';
import type { DecisionRecord, DecisionStanding, ProviderDecisionApprovalAnswer } from '../../../lib/api-types';
import type { Fetched } from '../../../lib/fetched';
import { usePrefs } from '../../../lib/prefs';
import { approveEffect, decisionName, evidenceName, isStale } from '../provider-operation-names';

/** The evidence of one step: its kind, the provider's reference, the note. Shared by the proposal and the record. */
export function Evidence({ record }: { record: DecisionRecord }) {
  const { t } = usePrefs();
  return (
    <>
      {record.evidenceKind || record.providerRef ? (
        <p className="po-evidence">
          {record.evidenceKind ? <span>{evidenceName(t, record.evidenceKind)}</span> : null}
          {record.providerRef ? <bdi dir="ltr">{record.providerRef}</bdi> : null}
          {record.suppliedEsimCode ? <span>{t.decCodeSupplied}</span> : null}
        </p>
      ) : null}
      {record.note ? <p className="po-note">{record.note}</p> : null}
    </>
  );
}

/**
 * The proposal that waits for a second account: what it is, who made it, on what evidence, and what approving
 * does to the money. Approve and refuse are offered only where the API said this account may; each asks once
 * more, repeating the effect. Used by the task ticket and by the queue.
 */
export function ProposalCard({
  standing,
  answer,
  onDone,
  onStale,
}: {
  standing: DecisionStanding;
  answer: (approve: boolean) => Promise<Fetched<ProviderDecisionApprovalAnswer>>;
  onDone: (answer: ProviderDecisionApprovalAnswer) => void;
  onStale: (message: string) => void;
}) {
  const { t, apiText } = usePrefs();
  const [asking, setAsking] = useState<null | 'approve' | 'refuse'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const proposal = standing.proposal;
  if (!proposal) return null;

  const close = () => {
    if (busy) return;
    setAsking(null);
    setError('');
  };
  const send = async () => {
    if (!asking || busy) return;
    setBusy(true);
    setError('');
    const result = await answer(asking === 'approve');
    setBusy(false);
    if (result.ok) {
      setAsking(null);
      onDone(result.data);
      return;
    }
    if (isStale(result.code)) {
      setAsking(null);
      onStale(apiText(result));
      return;
    }
    setError(apiText(result));
  };
  // Why this account is offered nothing, or only a refusal.
  const hint = standing.blocked === 'own-proposal' ? t.propOwn : standing.blocked === 'own-task' ? t.propOwnTask : !standing.canApprove && standing.canRefuse ? t.propStale : '';

  return (
    <div className="po-proposal">
      <p className="po-proposal-head">
        <b>{decisionName(t, proposal.decision)}</b>
        <span>{t.propBy}: <AccountName login={proposal.accountLoginName} /></span>
        <bdi dir="ltr">{latinWhen(proposal.at)}</bdi>
      </p>
      <Evidence record={proposal} />
      <p className="po-effect">{approveEffect(t, proposal.decision)}</p>
      {hint ? <p className="hint">{hint}</p> : null}
      {standing.canApprove || standing.canRefuse ? (
        <div className="po-actions">
          {standing.canApprove ? <Button type="button" size="sm" onClick={() => setAsking('approve')}>{t.propApprove}</Button> : null}
          {standing.canRefuse ? <Button type="button" size="sm" variant="secondary" onClick={() => setAsking('refuse')}>{t.propRefuse}</Button> : null}
        </div>
      ) : null}
      <Dialog
        open={asking !== null}
        size="confirm"
        title={asking === 'approve' ? `${t.propApprove}: ${decisionName(t, proposal.decision)}` : t.propRefuse}
        lede={asking === 'approve' ? approveEffect(t, proposal.decision) : t.propRefuseHint}
        mark={asking === 'approve' ? 'shield' : 'alert'}
        tone={asking === 'approve' && proposal.decision === 'release-after-success' ? 'danger' : 'neutral'}
        closeLabel={t.closeMenu}
        error={error}
        onClose={close}
        footer={(
          <>
            <Button type="button" variant="secondary" disabled={busy} onClick={close}>{t.cancel}</Button>
            <Button type="button" variant={asking === 'refuse' ? 'danger' : 'primary'} disabled={busy} onClick={() => void send()}>
              {asking === 'approve' ? t.propConfirmApprove : t.propConfirmRefuse}
            </Button>
          </>
        )}
      >
        <Evidence record={proposal} />
      </Dialog>
    </div>
  );
}
