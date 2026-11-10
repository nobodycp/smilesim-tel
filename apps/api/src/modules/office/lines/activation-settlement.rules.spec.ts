import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OPERATION_STATUSES, validKey, type OperationStatus } from '../providers/operations/provider-operation.rules';
import {
  APPLY_ERRORS, DECISIONS, DECISION_EVENT_TYPES, EVIDENCE_KINDS, MIN_DECISION_NOTE,
  decisionStep, inFlight, needsSecondAccount, openProposal, operationKey, phaseOf, settlementOf, sweepable, taskActions,
  type Decision, type DecisionActor, type DecisionEvent, type DecisionEvidence, type DecisionRequest, type OperationPhase, type TaskOperation,
} from './activation-settlement.rules';

const at = new Date('2026-11-10T12:00:00Z');
const operation = (status: OperationStatus, over: Partial<NonNullable<TaskOperation>> = {}): TaskOperation => ({ status, appliedAt: null, applyError: null, ...over });

/** Every state a task's operation can be in, by the name the rules give it. */
const PHASES: Record<OperationPhase, TaskOperation> = {
  none: null,
  requested: operation('requested'),
  pending: operation('pending'),
  unknown: operation('unknown'),
  unapplied: operation('succeeded'),
  exception: operation('succeeded', { applyError: 'number-taken' }),
  applied: operation('succeeded', { appliedAt: at }),
  failed: operation('failed'),
};
const phases = Object.keys(PHASES) as OperationPhase[];

describe('operation phase and key', () => {
  it('names each state of a task\'s operation', () => {
    for (const phase of phases) expect([phase, phaseOf(PHASES[phase])]).toEqual([phase, phase]);
    // Applied wins over a recorded error (an exception closed by "apply corrected"), and a handed-over failure is still failed.
    expect(phaseOf(operation('succeeded', { appliedAt: at, applyError: 'sim-taken' }))).toBe('applied');
    expect(phaseOf(operation('failed', { appliedAt: at }))).toBe('failed');
    // Every operation status has a phase.
    for (const status of OPERATION_STATUSES) expect(phases).toContain(phaseOf(operation(status)));
  });

  it('makes the key from the task alone, the same every time, and valid for an operation', () => {
    const taskId = '1a217504-f249-4f5c-91af-e6881bfcd5a5';
    expect(operationKey(taskId)).toBe(`activate:${taskId}`);
    expect(operationKey(taskId)).toBe(operationKey(taskId));
    expect(validKey(operationKey(taskId))).toBe(true);
    expect(operationKey('task-a')).not.toBe(operationKey('task-b'));
    for (const bad of ['', 'has space', 'semi;colon', 'x'.repeat(200)]) expect(() => operationKey(bad)).toThrow(RangeError);
  });
});

describe('what an operation allows on its task (D6)', () => {
  it('is exactly the table of the spec', () => {
    const table: Record<OperationPhase, [complete: boolean, reject: boolean, cancel: string]> = {
      none: [true, true, 'allowed'],
      requested: [false, false, 'abandons-operation'],
      pending: [false, false, 'refused'],
      unknown: [false, false, 'refused'],
      unapplied: [false, false, 'refused'],
      exception: [false, false, 'refused'],
      applied: [false, false, 'refused'],
      failed: [true, true, 'allowed'],
    };
    for (const phase of phases) {
      const actions = taskActions(PHASES[phase]);
      expect([phase, actions.complete, actions.reject, actions.cancel]).toEqual([phase, ...table[phase]]);
    }
  });

  it('lets nobody complete, reject or cancel while the provider may have the request, or has confirmed it', () => {
    for (const phase of ['pending', 'unknown', 'unapplied', 'exception'] as const) {
      expect(taskActions(PHASES[phase])).toEqual({ complete: false, reject: false, cancel: 'refused' });
    }
    // An unknown operation stays frozen whatever else is recorded on it.
    expect(taskActions(operation('unknown', { appliedAt: at }))).toEqual({ complete: false, reject: false, cancel: 'refused' });
    expect(taskActions(operation('unknown', { applyError: 'sim-taken' }))).toEqual({ complete: false, reject: false, cancel: 'refused' });
  });

  it('lets only the submitter\'s cancel touch a requested operation, and never the branch', () => {
    expect(taskActions(PHASES.requested)).toEqual({ complete: false, reject: false, cancel: 'abandons-operation' });
    // The one phase where a cancel changes the operation too.
    expect(phases.filter((phase) => taskActions(PHASES[phase]).cancel === 'abandons-operation')).toEqual(['requested']);
  });

  it('gives a failed operation\'s task back to the branch whole, handed over or not', () => {
    expect(taskActions(operation('failed'))).toEqual({ complete: true, reject: true, cancel: 'allowed' });
    expect(taskActions(operation('failed', { appliedAt: at }))).toEqual({ complete: true, reject: true, cancel: 'allowed' });
  });

  it('counts as in flight exactly the states whose money and reservation must not move', () => {
    expect(phases.filter((phase) => inFlight(PHASES[phase]))).toEqual(['requested', 'pending', 'unknown', 'unapplied', 'exception']);
    // In flight and "may be completed by hand" never hold together.
    for (const phase of phases) expect(inFlight(PHASES[phase]) && taskActions(PHASES[phase]).complete).toBe(false);
  });
});

describe('the settlement\'s next step', () => {
  it('follows the operation\'s state', () => {
    const steps: Record<OperationPhase, string> = {
      none: 'none', requested: 'wait', pending: 'wait', unknown: 'await-decision', unapplied: 'apply', exception: 'await-decision', applied: 'settled', failed: 'hand-to-branch',
    };
    for (const phase of phases) expect([phase, settlementOf(PHASES[phase])]).toEqual([phase, steps[phase]]);
    // A failure is handed to the branch once.
    expect(settlementOf(operation('failed', { appliedAt: at }))).toBe('settled');
  });

  it('never applies, releases or hands over an unknown operation or an exception by itself', () => {
    for (const waiting of [PHASES.unknown, PHASES.exception, operation('succeeded', { applyError: 'target-missing' })]) {
      expect(settlementOf(waiting)).toBe('await-decision');
      expect(sweepable(waiting)).toBe(false);
    }
  });

  it('gives the sweeper only what the system itself may finish', () => {
    expect(phases.filter((phase) => sweepable(PHASES[phase]))).toEqual(['unapplied', 'failed']);
    expect(sweepable(operation('failed', { appliedAt: at }))).toBe(false);
    expect(sweepable(operation('succeeded', { appliedAt: at }))).toBe(false);
  });
});

describe('decisions by people (D15)', () => {
  const owner: DecisionActor = { id: 'owner', layer: 'branch', isBranchOwner: true, grants: [], impersonating: false };
  const accountant: DecisionActor = { id: 'accountant', layer: 'branch', isBranchOwner: false, grants: ['read', 'accounting'], impersonating: false };
  const second: DecisionActor = { id: 'accountant-2', layer: 'branch', isBranchOwner: false, grants: ['accounting'], impersonating: false };
  const evidence: DecisionEvidence = { kind: 'provider-portal', note: 'The provider portal shows the line as active.', providerRef: 'REF-77' };
  const base = { submitterId: 'pos-1' };
  const decide = (decision: Decision, on: TaskOperation, over: Partial<DecisionEvidence> = {}): DecisionRequest => ({ act: 'decide', decision, evidence: { ...evidence, ...over }, operation: on, ...base });
  const answer = (act: 'approve' | 'refuse', on: TaskOperation): DecisionRequest => ({ act, operation: on, ...base });
  const proposed = (decision: Decision, accountId = 'owner', sequence = 1): DecisionEvent => ({ sequence, type: 'proposed', decision, accountId });
  const refusal = (step: ReturnType<typeof decisionStep>) => (step.ok ? null : step.refusal);

  it('keeps its lists in step with what the database accepts', () => {
    const sql = readFileSync(join(__dirname, '../../../../prisma/migrations/20261110190000_activation_settlement_schema/migration.sql'), 'utf8');
    // The quoted values of `CONSTRAINT "<name>" CHECK (… IN ('a', 'b', …))`.
    const listOf = (constraint: string) => {
      const from = sql.indexOf(`"${constraint}" CHECK`);
      const list = sql.slice(sql.indexOf(' IN (', from) + 5, sql.indexOf(')', sql.indexOf(' IN (', from)));
      return from < 0 ? [] : [...list.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    };
    expect(listOf('ProviderDecisionEvent_type_known')).toEqual([...DECISION_EVENT_TYPES]);
    expect(listOf('ProviderDecisionEvent_decision_known')).toEqual([...DECISIONS]);
    expect(listOf('ProviderDecisionEvent_evidenceKind_known')).toEqual([...EVIDENCE_KINDS]);
    expect(listOf('ProviderOperation_applyError_known')).toEqual([...APPLY_ERRORS]);
    expect(sql).toContain(`char_length(btrim("note")) >= ${MIN_DECISION_NOTE}`);
  });

  it('asks a second account for the two decisions that let money go back, and only those', () => {
    expect(DECISIONS.filter(needsSecondAccount)).toEqual(['declare-failure', 'release-after-success']);
  });

  it('lets one authorised account confirm a success on an unknown operation, at once', () => {
    for (const actor of [owner, accountant]) {
      expect(decisionStep([], actor, decide('confirm-success', PHASES.unknown))).toEqual({ ok: true, event: { sequence: 1, type: 'applied', decision: 'confirm-success' }, effect: 'confirm-success' });
    }
  });

  it('lets one authorised account apply corrected data on an exception, at once', () => {
    expect(decisionStep([], accountant, decide('apply-corrected', PHASES.exception))).toEqual({ ok: true, event: { sequence: 1, type: 'applied', decision: 'apply-corrected' }, effect: 'apply-corrected' });
    // A reference is asked only of a confirmed success.
    expect(decisionStep([], accountant, decide('apply-corrected', PHASES.exception, { providerRef: null })).ok).toBe(true);
  });

  it.each([
    ['declare-failure', 'unknown'],
    ['release-after-success', 'exception'],
  ] as const)('only proposes %s: nothing takes effect until another account approves', (decision, phase) => {
    const step = decisionStep([], owner, decide(decision, PHASES[phase], { providerRef: null }));
    expect(step).toEqual({ ok: true, event: { sequence: 1, type: 'proposed', decision }, effect: 'none' });
    const events = [proposed(decision, 'owner')];
    // The proposer cannot approve, however they are authorised.
    expect(refusal(decisionStep(events, owner, answer('approve', PHASES[phase])))).toBe('own-proposal');
    // Another authorised account can: that is when it takes effect.
    expect(decisionStep(events, accountant, answer('approve', PHASES[phase]))).toEqual({ ok: true, event: { sequence: 2, type: 'approved', decision }, effect: decision });
    // The same proposal made by the accountant is approved by the owner, not by the accountant.
    expect(refusal(decisionStep([proposed(decision, 'accountant')], accountant, answer('approve', PHASES[phase])))).toBe('own-proposal');
    expect(decisionStep([proposed(decision, 'accountant')], owner, answer('approve', PHASES[phase]))).toMatchObject({ ok: true, effect: decision });
  });

  it('leaves the operation as it is for as long as no second account approves', () => {
    const events = [proposed('declare-failure', 'owner')];
    // Nothing else can be decided over the open proposal, by anyone: not the same decision again, not its opposite.
    for (const actor of [owner, accountant, second]) {
      expect(refusal(decisionStep(events, actor, decide('declare-failure', PHASES.unknown)))).toBe('proposal-open');
      expect(refusal(decisionStep(events, actor, decide('confirm-success', PHASES.unknown)))).toBe('proposal-open');
    }
    // And no step of the proposal carries an effect by itself.
    expect(decisionStep([], owner, decide('declare-failure', PHASES.unknown))).toMatchObject({ effect: 'none' });
    expect(openProposal(events)).toEqual(events[0]);
  });

  it('closes a proposal only by another account\'s refusal, with no effect, and then a new decision may be made', () => {
    const events = [proposed('declare-failure', 'owner')];
    expect(decisionStep(events, accountant, answer('refuse', PHASES.unknown))).toEqual({ ok: true, event: { sequence: 2, type: 'refused', decision: 'declare-failure' }, effect: 'none' });
    const closed: DecisionEvent[] = [...events, { sequence: 2, type: 'refused', decision: 'declare-failure', accountId: 'accountant' }];
    expect(openProposal(closed)).toBeNull();
    expect(refusal(decisionStep(closed, accountant, answer('approve', PHASES.unknown)))).toBe('no-proposal');
    expect(decisionStep(closed, accountant, decide('confirm-success', PHASES.unknown))).toEqual({ ok: true, event: { sequence: 3, type: 'applied', decision: 'confirm-success' }, effect: 'confirm-success' });
    expect(decisionStep(closed, accountant, decide('declare-failure', PHASES.unknown))).toMatchObject({ ok: true, event: { sequence: 3, type: 'proposed' } });
  });

  it('gives the account that made a proposal no way to answer it: it can neither approve nor withdraw it', () => {
    for (const [decision, phase] of [['declare-failure', 'unknown'], ['release-after-success', 'exception']] as const) {
      for (const proposer of [owner, accountant]) {
        const events = [proposed(decision, proposer.id)];
        expect(refusal(decisionStep(events, proposer, answer('approve', PHASES[phase])))).toBe('own-proposal');
        expect(refusal(decisionStep(events, proposer, answer('refuse', PHASES[phase])))).toBe('own-proposal');
        // Nor by deciding something else over it, nor once it has gone stale.
        expect(refusal(decisionStep(events, proposer, decide(decision, PHASES[phase])))).toBe('proposal-open');
        expect(refusal(decisionStep(events, proposer, answer('refuse', PHASES.applied)))).toBe('own-proposal');
        // Only another authorised account closes it.
        const other = proposer.id === 'owner' ? accountant : owner;
        expect(decisionStep(events, other, answer('refuse', PHASES[phase]))).toMatchObject({ ok: true, event: { type: 'refused' }, effect: 'none' });
      }
    }
  });

  it('refuses an entered session, an account that is not authorised, and the task\'s submitter, for every step', () => {
    const requests: DecisionRequest[] = [decide('confirm-success', PHASES.unknown), decide('declare-failure', PHASES.unknown), answer('approve', PHASES.unknown), answer('refuse', PHASES.unknown)];
    const events = [proposed('declare-failure', 'owner')];
    const entered = { ...accountant, impersonating: true };
    const ownerEntered = { ...owner, impersonating: true };
    const outsiders: DecisionActor[] = [
      { id: 'clerk', layer: 'branch', isBranchOwner: false, grants: ['read', 'edit', 'tasks', 'reports', 'staff'], impersonating: false },
      { id: 'main', layer: 'main_agent', isBranchOwner: false, grants: ['accounting', 'tasks'], impersonating: false },
      { id: 'agent', layer: 'agent', isBranchOwner: false, grants: ['accounting'], impersonating: false },
      { id: 'pos-2', layer: 'pos', isBranchOwner: false, grants: ['accounting'], impersonating: false },
      { id: 'odd', layer: 'pos', isBranchOwner: true, grants: [], impersonating: false },
    ];
    for (const request of requests) {
      const history = request.act === 'decide' ? [] : events;
      expect(refusal(decisionStep(history, entered, request))).toBe('entered-session');
      expect(refusal(decisionStep(history, ownerEntered, request))).toBe('entered-session');
      for (const outsider of outsiders) expect([outsider.id, refusal(decisionStep(history, outsider, request))]).toEqual([outsider.id, 'not-authorised']);
      // An authorised account that submitted the task itself decides nothing about it.
      expect(refusal(decisionStep(history, accountant, { ...request, submitterId: 'accountant' }))).toBe('own-task');
    }
  });

  it('refuses a decision about a state the operation is not in', () => {
    const wrong: [Decision, OperationPhase[]][] = [
      ['confirm-success', ['none', 'requested', 'pending', 'unapplied', 'exception', 'applied', 'failed']],
      ['declare-failure', ['none', 'requested', 'pending', 'unapplied', 'exception', 'applied', 'failed']],
      ['apply-corrected', ['none', 'requested', 'pending', 'unknown', 'unapplied', 'applied', 'failed']],
      ['release-after-success', ['none', 'requested', 'pending', 'unknown', 'unapplied', 'applied', 'failed']],
    ];
    for (const [decision, where] of wrong) {
      for (const phase of where) expect([decision, phase, refusal(decisionStep([], owner, decide(decision, PHASES[phase])))]).toEqual([decision, phase, 'not-applicable']);
    }
    // A success that waits to be applied is the system's to apply: no person releases it or corrects it yet.
    expect(refusal(decisionStep([], owner, decide('release-after-success', PHASES.unapplied)))).toBe('not-applicable');
  });

  it('never approves a stale proposal, so it moves no money: once the operation left the state it was made about, it can only be refused', () => {
    // What each proposal was made about, and every state the operation can have moved to since.
    const stale: [Decision, OperationPhase[]][] = [
      // The provider answered late (ADR 0018), or the settlement then ran.
      ['declare-failure', ['unapplied', 'applied', 'exception', 'failed']],
      // The exception was closed, or (never by a rule, but whatever the row says) the operation is elsewhere.
      ['release-after-success', ['applied', 'unapplied', 'unknown', 'failed']],
    ];
    for (const [decision, moved] of stale) {
      const events = [proposed(decision, 'owner')];
      for (const phase of moved) {
        for (const approver of [accountant, second]) {
          const step = decisionStep(events, approver, answer('approve', PHASES[phase]));
          expect([decision, phase, approver.id, refusal(step)]).toEqual([decision, phase, approver.id, 'not-applicable']);
        }
        // Closing it writes a refusal and has no effect.
        expect(decisionStep(events, accountant, answer('refuse', PHASES[phase]))).toEqual({ ok: true, event: { sequence: 2, type: 'refused', decision }, effect: 'none' });
      }
    }
    // The only step that carries a money-moving effect is an approval, and only on the state the proposal is about.
    for (const decision of ['declare-failure', 'release-after-success'] as const) {
      for (const phase of phases) {
        const step = decisionStep([proposed(decision, 'owner')], accountant, answer('approve', PHASES[phase]));
        const about = decision === 'declare-failure' ? 'unknown' : 'exception';
        expect([decision, phase, step.ok && step.effect]).toEqual([decision, phase, phase === about ? decision : false]);
      }
    }
  });

  it('refuses a decision without evidence, with a short note, or a success without a reference', () => {
    const on = PHASES.unknown;
    expect(refusal(decisionStep([], owner, decide('confirm-success', on, { kind: null })))).toBe('evidence-missing');
    expect(refusal(decisionStep([], owner, decide('confirm-success', on, { kind: 'a-feeling' })))).toBe('evidence-missing');
    expect(refusal(decisionStep([], owner, decide('confirm-success', on, { note: 'too short' })))).toBe('note-too-short');
    expect(refusal(decisionStep([], owner, decide('confirm-success', on, { note: `   ${'x'.repeat(MIN_DECISION_NOTE - 1)}   ` })))).toBe('note-too-short');
    expect(refusal(decisionStep([], owner, decide('confirm-success', on, { providerRef: null })))).toBe('reference-missing');
    expect(refusal(decisionStep([], owner, decide('confirm-success', on, { providerRef: '   ' })))).toBe('reference-missing');
    // Exactly the minimum passes; a proposal needs the same evidence, though no reference.
    expect(decisionStep([], owner, decide('confirm-success', on, { note: 'x'.repeat(MIN_DECISION_NOTE) })).ok).toBe(true);
    expect(refusal(decisionStep([], owner, decide('declare-failure', on, { note: 'short' })))).toBe('note-too-short');
    expect(refusal(decisionStep([], owner, decide('declare-failure', on, { kind: null })))).toBe('evidence-missing');
    expect(decisionStep([], owner, decide('declare-failure', on, { providerRef: null })).ok).toBe(true);
  });

  it('numbers each step after the last, whatever order the events are given in', () => {
    const history: DecisionEvent[] = [
      { sequence: 3, type: 'proposed', decision: 'declare-failure', accountId: 'accountant' },
      { sequence: 1, type: 'proposed', decision: 'declare-failure', accountId: 'owner' },
      { sequence: 2, type: 'refused', decision: 'declare-failure', accountId: 'accountant' },
    ];
    expect(openProposal(history)).toMatchObject({ sequence: 3, accountId: 'accountant' });
    expect(decisionStep(history, owner, answer('approve', PHASES.unknown))).toEqual({ ok: true, event: { sequence: 4, type: 'approved', decision: 'declare-failure' }, effect: 'declare-failure' });
    expect(refusal(decisionStep(history, accountant, answer('approve', PHASES.unknown)))).toBe('own-proposal');
  });

  it('answers an approval or a refusal with no proposal as such', () => {
    for (const act of ['approve', 'refuse'] as const) expect(refusal(decisionStep([], owner, answer(act, PHASES.unknown)))).toBe('no-proposal');
    const applied: DecisionEvent[] = [{ sequence: 1, type: 'applied', decision: 'confirm-success', accountId: 'owner' }];
    expect(refusal(decisionStep(applied, accountant, answer('approve', PHASES.unknown)))).toBe('no-proposal');
  });
});
