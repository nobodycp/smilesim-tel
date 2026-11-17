'use client';

import { useState } from 'react';
import { Dialog } from '../../../components/dialog';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Select, SelectItem } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
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

  // The look of the form: a grid 12px apart; a field's caption is the dialog label (11px bold `--rd-muted`, 4px above
  // the field) and its hint 12px medium; the number and serial share a row while each has 13rem; the note is at least
  // 5.5rem tall with no padding above or below; the counter spreads its words and its figure,
  // the figure in `--rd-success` once the note is long enough. Fields are 34px (44px at 720px and under).
  const hint = 'text-sm font-medium';
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
        className="grid content-start gap-3"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Label tone="dialog">
          {t.decEvidence}
          <Select place="dialog" value={kind} required onValueChange={setKind}>
            <SelectItem value="">{t.decChoose}</SelectItem>
            {EVIDENCE_KINDS.map((value) => <SelectItem key={value} value={value}>{evidenceName(t, value)}</SelectItem>)}
          </Select>
        </Label>
        <Label tone="dialog">
          <span>{t.decRef} <small className={hint}>({referenceNeeded ? t.decRequired : t.decOptional})</small></span>
          <Input value={reference} dir="ltr" maxLength={120} required={referenceNeeded} onChange={(event) => setReference(event.target.value)} />
        </Label>
        {line ? (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-3">
            <Label tone="dialog">
              <span>{t.decNumber} <small className={hint}>({needs.number ? t.decRequired : t.decOptional})</small></span>
              <Input value={number} dir="ltr" inputMode="numeric" maxLength={10} required={needs.number} aria-invalid={number.trim() !== '' && !numberOk} onChange={(event) => setNumber(event.target.value)} />
            </Label>
            <Label tone="dialog">
              <span>{t.decSerial} <small className={hint}>({t.decOptional})</small></span>
              <Input value={serial} dir="ltr" inputMode="numeric" maxLength={22} aria-invalid={!serialOk} onChange={(event) => setSerial(event.target.value)} />
            </Label>
          </div>
        ) : null}
        {line && needs.esimCode ? (
          <Label tone="dialog">
            {t.decCode}
            {/* Never autofilled, never remembered by the browser, and gone when the dialog closes. */}
            <Input value={code} dir="ltr" required autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} maxLength={512} aria-invalid={code !== '' && !codeOk} aria-describedby="decision-code-hint" onChange={(event) => setCode(event.target.value)} />
            <span className={hint} id="decision-code-hint">{t.decCodeHint}</span>
          </Label>
        ) : null}
        <Label tone="dialog">
          {t.decNote}
          <Textarea className="min-h-22 py-0" value={note} rows={3} required maxLength={2000} aria-describedby="decision-note-hint" onChange={(event) => setNote(event.target.value)} />
          <span className={`${hint} flex justify-between gap-2`} data-testid="decision-count" id="decision-note-hint">
            <span>{t.decNoteHint}</span>
            <bdi dir="ltr" className={noteLength >= MIN_DECISION_NOTE ? 'text-success' : undefined}>{noteLength}/{MIN_DECISION_NOTE}</bdi>
          </span>
        </Label>
      </form>
    </Dialog>
  );
}
