'use client';

import { useState } from 'react';
import { Dialog } from '../../../components/dialog';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import type { DecisionView, ProviderDecision, ProviderDecisionAnswer, ProviderDecisionBody } from '../../../lib/api-types';
import type { Fetched } from '../../../lib/fetched';
import { usePrefs } from '../../../lib/prefs';
import { EVIDENCE_KINDS, MIN_DECISION_NOTE, decisionEffect, decisionName, evidenceName, isProposal, isStale, makesLine } from '../provider-operation-names';

/**
 * The form of one decision on a task's provider operation (spec 2026-11-12-provider-operation-screens, 3).
 *
 * The dialog is mounted for one decision and unmounted when it closes, so everything typed into it, the eSIM
 * activation code included, lives in this component's state and nowhere else, and is gone with it: nothing is
 * written to the address, to storage, to the query cache or to the console. The checks here help the person;
 * the API judges the request.
 */
export function DecisionDialog({
  decision,
  needs,
  send,
  onClose,
  onDone,
  onStale,
}: {
  decision: ProviderDecision;
  needs: DecisionView['needs'];
  send: (body: ProviderDecisionBody) => Promise<Fetched<ProviderDecisionAnswer>>;
  onClose: () => void;
  /** The decision went through: the caller says so and asks for the data again. */
  onDone: (answer: ProviderDecisionAnswer) => void;
  /** The operation is no longer where this form was opened for: the caller says so and asks again. */
  onStale: (message: string) => void;
}) {
  const { t, apiText } = usePrefs();
  const [kind, setKind] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [number, setNumber] = useState('');
  const [serial, setSerial] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const line = makesLine(decision);
  const referenceNeeded = decision === 'confirm-success';
  const noteLength = note.trim().length;
  const numberOk = number.trim() === '' ? !needs.number : /^05\d{8}$/.test(number.trim());
  const serialOk = serial.trim() === '' || /^\d{8,22}$/.test(serial.trim());
  const codeOk = !needs.esimCode || /^LPA:1\$[A-Za-z0-9.-]+\$\S*$/.test(code.trim());
  const ready = kind !== '' && noteLength >= MIN_DECISION_NOTE && (!referenceNeeded || reference.trim() !== '') && (!line || (numberOk && serialOk && codeOk));

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    const result = await send({
      decision,
      evidenceKind: kind,
      note: note.trim(),
      ...(reference.trim() ? { providerRef: reference.trim() } : {}),
      ...(line && number.trim() ? { msisdn: number.trim() } : {}),
      ...(line && serial.trim() ? { iccid: serial.trim() } : {}),
      ...(line && needs.esimCode ? { esimCode: code.trim() } : {}),
    });
    setBusy(false);
    if (result.ok) {
      onDone(result.data);
      return;
    }
    // The operation moved on while the form was open: nothing here can be sent again as it is.
    if (isStale(result.code)) {
      onStale(apiText(result));
      return;
    }
    // A refusal of the request, or no connection: said here, the form stays, and nothing is sent again by itself.
    setError(apiText(result));
  };

  return (
    <Dialog
      open
      size="form"
      title={decisionName(t, decision)}
      lede={decisionEffect(t, decision)}
      mark={isProposal(decision) ? 'shield' : 'check'}
      tone={decision === 'release-after-success' || decision === 'declare-failure' ? 'danger' : 'neutral'}
      closeLabel={t.closeMenu}
      error={error}
      onClose={() => { if (!busy) onClose(); }}
      footer={(
        <>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>{t.cancel}</Button>
          <Button type="submit" form="decision-form" disabled={!ready || busy}>
            {isProposal(decision) ? t.decSubmitProposal : t.decSubmitNow}
          </Button>
        </>
      )}
    >
      <form
        id="decision-form"
        className="dialog-form decision-form"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label>
          {t.decEvidence}
          <Select value={kind} required onChange={(event) => setKind(event.target.value)}>
            <option value="">{t.decChoose}</option>
            {EVIDENCE_KINDS.map((value) => <option key={value} value={value}>{evidenceName(t, value)}</option>)}
          </Select>
        </label>
        <label>
          <span>{t.decRef} <small className="hint">({referenceNeeded ? t.decRequired : t.decOptional})</small></span>
          <input value={reference} dir="ltr" maxLength={120} required={referenceNeeded} onChange={(event) => setReference(event.target.value)} />
        </label>
        {line ? (
          <div className="decision-pair">
            <label>
              <span>{t.decNumber} <small className="hint">({needs.number ? t.decRequired : t.decOptional})</small></span>
              <input value={number} dir="ltr" inputMode="numeric" maxLength={10} required={needs.number} aria-invalid={number.trim() !== '' && !numberOk} onChange={(event) => setNumber(event.target.value)} />
            </label>
            <label>
              <span>{t.decSerial} <small className="hint">({t.decOptional})</small></span>
              <input value={serial} dir="ltr" inputMode="numeric" maxLength={22} aria-invalid={!serialOk} onChange={(event) => setSerial(event.target.value)} />
            </label>
          </div>
        ) : null}
        {line && needs.esimCode ? (
          <label>
            {t.decCode}
            {/* Never autofilled, never remembered by the browser, and gone when the dialog closes. */}
            <input value={code} dir="ltr" required autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} maxLength={512} aria-invalid={code !== '' && !codeOk} aria-describedby="decision-code-hint" onChange={(event) => setCode(event.target.value)} />
            <span className="hint" id="decision-code-hint">{t.decCodeHint}</span>
          </label>
        ) : null}
        <label>
          {t.decNote}
          <textarea value={note} rows={3} required maxLength={2000} aria-describedby="decision-note-hint" onChange={(event) => setNote(event.target.value)} />
          <span className="hint decision-count" id="decision-note-hint">
            <span>{t.decNoteHint}</span>
            <bdi dir="ltr" className={noteLength >= MIN_DECISION_NOTE ? 'ok' : ''}>{noteLength}/{MIN_DECISION_NOTE}</bdi>
          </span>
        </label>
      </form>
    </Dialog>
  );
}
