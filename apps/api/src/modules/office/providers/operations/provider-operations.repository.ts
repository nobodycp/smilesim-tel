import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../../generated/prisma/client';
import type { Db } from '../../kernel/unit-of-work';
import type { OperationError, OperationRequest, OperationStatus } from './provider-operation.rules';

/** The outbox topic of an operation that waits to be sent. */
export const OPERATION_REQUESTED = 'provider-operation.requested';

/** The outbox topic of an operation whose attempt came to a verdict: succeeded, failed or unknown (ADR 0019, D8). */
export const OPERATION_SETTLED = 'provider-operation.settled';

/** What a confirmed activation handed back, as the columns hold it: the eSIM code sealed, or absent. */
export type ResultColumns = { msisdn: string | null; iccid: string | null; sealedEsimCode: string | null };

/** Which part of the queue: operations with a proposal to answer, or the ones nobody has decided on yet. */
export type WaitingFor = 'approval' | 'decision';

/** An operation of an open task that only a person can move (ADR 0019, D15): unknown, or an exception. */
const AWAITS_PERSON = Prisma.sql`t."status" = 'working' AND (o."status" = 'unknown' OR (o."status" = 'succeeded' AND o."appliedAt" IS NULL AND o."applyError" IS NOT NULL))`;

/** Its last decision step is a proposal: the rule `openProposal` reads the same thing from the events. */
const OPEN_PROPOSAL = Prisma.sql`EXISTS (
  SELECT 1 FROM "ProviderDecisionEvent" e WHERE e."operationId" = o."id" AND e."type" = 'proposed'
    AND e."sequence" = (SELECT max(x."sequence") FROM "ProviderDecisionEvent" x WHERE x."operationId" = o."id"))`;

function narrowed(waiting: WaitingFor | undefined) {
  if (waiting === 'approval') return Prisma.sql`AND ${OPEN_PROPOSAL}`;
  return waiting === 'decision' ? Prisma.sql`AND NOT ${OPEN_PROPOSAL}` : Prisma.empty;
}

/** One step of a person's decision as it is stored (ADR 0019, D15). It has no column for an eSIM code. */
export type NewDecisionEvent = {
  operationId: string;
  sequence: number;
  type: string;
  decision: string;
  evidenceKind: string | null;
  providerRef: string | null;
  note: string;
  suppliedEsimCode: boolean;
  accountId: string;
  accountLoginName: string;
};

/** `taskId` links the operation to the activation task it was recorded for (ADR 0019, D2): unique, one operation a task. */
export type NewOperation = Omit<OperationRequest, 'providerCode'> & { idempotencyKey: string; requestHash: string; providerId: string; taskId?: string };
/**
 * `claim` starts a new attempt: numbered, leased until the given time, with no send mark. `waive` says the attempt
 * being ended is not counted against the budget (it was handed back while the provider's gate was closed); the
 * attempt's number stays.
 */
export type StatusChange = { status: OperationStatus; providerRef?: string | null; error: OperationError | null; claim?: { at: Date; leaseUntil: Date }; result?: ResultColumns | null; waive?: true };
/** The state a guarded write expects: the status, and where given the attempt's number and that nothing was sent. */
export type Expected = { status: OperationStatus; attempts?: number; unsent?: true };

/**
 * Provider operations and the outbox as the database holds them. Every method takes the client, so an operation,
 * its outbox message and whatever its caller writes are one transaction. No rule lives here.
 */
@Injectable()
export class ProviderOperationsRepository {
  /**
   * Inserts the operation unless its key is taken (`ON CONFLICT DO NOTHING`, so a lost race does not abort the
   * caller's transaction). Answers the new id, or null when the key already has an operation.
   */
  async insertUnlessKeyTaken(db: Db, row: NewOperation): Promise<string | null> {
    const id = randomUUID();
    const made = await db.providerOperation.createMany({ data: [{ id, status: 'requested', ...row }], skipDuplicates: true });
    return made.count === 1 ? id : null;
  }

  async providerIdByCode(db: Db, code: string): Promise<string | null> {
    return (await db.provider.findUnique({ where: { code }, select: { id: true } }))?.id ?? null;
  }

  /**
   * Says the operation waits to be sent. `sequence` is the number of attempts already made: the database holds one
   * message per send, so two writers of the same one cannot both commit.
   */
  addOutbox(db: Db, topic: string, aggregateId: string, sequence: number) {
    return db.outboxMessage.create({ data: { topic, aggregateId, sequence, payload: { operationId: aggregateId } } });
  }

  operationById(db: Db, id: string) {
    return db.providerOperation.findUnique({ where: { id } });
  }

  operationByKey(db: Db, idempotencyKey: string) {
    return db.providerOperation.findUnique({ where: { idempotencyKey } });
  }

  /** The operation with its provider's code: what the dispatcher sends. */
  operationToSend(db: Db, id: string) {
    return db.providerOperation.findUnique({ where: { id }, include: { provider: { select: { code: true } } } });
  }

  /**
   * One page of the operations that wait to be sent, in the order of their ids, after `afterId` (from the start
   * when it is null). The id never changes, so a walk by it meets every operation that stays waiting once and
   * none twice, whatever is taken, sent or recorded meanwhile; it is never ordered by a column a write moves.
   * At most `limit` rows are read: the walk is a page at a time, never the whole table.
   */
  async requestedPage(db: Db, afterId: string | null, limit: number): Promise<string[]> {
    const rows = await db.providerOperation.findMany({ where: { status: 'requested', ...(afterId ? { id: { gt: afterId } } : {}) }, orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    return rows.map((row) => row.id);
  }

  /** Pending operations whose lease is over (or that never had one), oldest first. */
  async expiredPendingIds(db: Db, now: Date, limit: number): Promise<string[]> {
    const rows = await db.providerOperation.findMany({
      where: { status: 'pending', OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      orderBy: { updatedAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /**
   * Writes the send mark of attempt `attempts`, once, while the operation is still pending on it **and its lease
   * still runs at `at`**: one statement, so a worker that wakes up after its lease cannot start a send that
   * recovery is entitled to take back. The provider is called only after this answered true, so an attempt
   * without the mark never reached the provider.
   */
  async markSent(db: Db, id: string, attempts: number, at: Date): Promise<boolean> {
    const marked = await db.providerOperation.updateMany({ where: { id, status: 'pending', attempts, sentAt: null, leaseUntil: { gt: at } }, data: { sentAt: at } });
    return marked.count === 1;
  }

  /**
   * Guarded: changes the row only while it is as `from` says (its status, and where given its attempt count and
   * an empty send mark), so a write that belongs to an earlier attempt finds nothing to change. Answers whether
   * it did.
   */
  async moveStatus(db: Db, id: string, from: Expected, change: StatusChange): Promise<boolean> {
    const moved = await db.providerOperation.updateMany({
      where: { id, status: from.status, ...(from.attempts !== undefined ? { attempts: from.attempts } : {}), ...(from.unsent ? { sentAt: null } : {}) },
      data: {
        status: change.status,
        lastError: change.error,
        ...(change.providerRef !== undefined ? { providerRef: change.providerRef } : {}),
        ...(change.claim ? { attempts: { increment: 1 }, lastAttemptAt: change.claim.at, leaseUntil: change.claim.leaseUntil, sentAt: null } : {}),
        ...(change.waive ? { waivedAttempts: { increment: 1 } } : {}),
        ...(change.result ? { resultMsisdn: change.result.msisdn, resultIccid: change.result.iccid, resultEsimCode: change.result.sealedEsimCode } : {}),
      },
    });
    return moved.count === 1;
  }

  /**
   * One page of the operations of tasks whose verdict the settlement still has to act on, in the order of their
   * ids, after `afterId` (from the start when it is null): succeeded with neither `appliedAt` nor `applyError`,
   * and failed with no `appliedAt`. An exception (`applyError`) and an unknown one are not among them: only a
   * person, or the provider's late answer, moves those. By id, never by the time of the last write: an operation
   * the settlement cannot act on for a technical reason is not written, so by that time it would stay first for
   * ever and, a hundred of them, hide every other.
   */
  async unsettledPage(db: Db, afterId: string | null, limit: number): Promise<string[]> {
    const rows = await db.providerOperation.findMany({
      where: { taskId: { not: null }, appliedAt: null, OR: [{ status: 'succeeded', applyError: null }, { status: 'failed' }], ...(afterId ? { id: { gt: afterId } } : {}) },
      orderBy: { id: 'asc' },
      take: limit,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /**
   * One page of the operations of tasks whose answer is not known, by id, after `afterId`: the ones the
   * settlement may still have to announce. An unknown operation stays in this list until a person or the
   * provider's late answer closes it, so the list is walked, not read from its top.
   */
  async unknownTaskOperationPage(db: Db, afterId: string | null, limit: number): Promise<string[]> {
    const rows = await db.providerOperation.findMany({ where: { taskId: { not: null }, status: 'unknown', ...(afterId ? { id: { gt: afterId } } : {}) }, orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    return rows.map((row) => row.id);
  }

  /**
   * Stamps a succeeded operation as applied, once: only while it is succeeded, not applied, without an exception
   * and still carries the result it was read with. Answers whether it did.
   */
  async markApplied(db: Db, id: string, read: { resultMsisdn: string | null; resultIccid: string | null; resultEsimCode: string | null }, at: Date): Promise<boolean> {
    const marked = await db.providerOperation.updateMany({
      where: { id, status: 'succeeded', appliedAt: null, applyError: null, resultMsisdn: read.resultMsisdn, resultIccid: read.resultIccid, resultEsimCode: read.resultEsimCode },
      data: { appliedAt: at },
    });
    return marked.count === 1;
  }

  /**
   * Writes why a succeeded operation could not be applied, once; its status and its result are not touched. The
   * code is one of the settlement's closed list (`APPLY_ERRORS`); the database refuses any other.
   */
  async markApplyError(db: Db, id: string, error: string, at: Date): Promise<boolean> {
    const marked = await db.providerOperation.updateMany({ where: { id, status: 'succeeded', appliedAt: null, applyError: null }, data: { applyError: error, applyFailedAt: at } });
    return marked.count === 1;
  }

  /**
   * Stamps an exception as applied by a person's decision (ADR 0019, D15 apply corrected), once: only while the
   * operation is succeeded, not applied, and carries an exception. The reason it could not be applied stays on
   * the row, with the time, as the record of what happened.
   */
  async markAppliedCorrected(db: Db, id: string, at: Date): Promise<boolean> {
    const marked = await db.providerOperation.updateMany({ where: { id, status: 'succeeded', appliedAt: null, applyError: { not: null } }, data: { appliedAt: at } });
    return marked.count === 1;
  }

  /** The operation of a task, or null for a task that never went to a provider. */
  operationByTask(db: Db, taskId: string) {
    return db.providerOperation.findUnique({ where: { taskId } });
  }

  /** The steps of the decisions people took on an operation, in order: what the rules read. */
  decisionEvents(db: Db, operationId: string) {
    return db.providerDecisionEvent.findMany({ where: { operationId }, orderBy: { sequence: 'asc' }, select: { sequence: true, type: true, decision: true, accountId: true } });
  }

  /**
   * Appends one step of a decision. The table is append-only and holds one row per (operation, sequence): a
   * second writer of the same step inserts nothing (`ON CONFLICT DO NOTHING`) and is answered false.
   */
  async addDecisionEvent(db: Db, row: NewDecisionEvent): Promise<boolean> {
    const made = await db.providerDecisionEvent.createMany({ data: [{ id: randomUUID(), ...row }], skipDuplicates: true });
    return made.count === 1;
  }

  /** The steps of the decisions on these operations as a person reads them, in order. It has no eSIM code to read. */
  decisionRecords(db: Db, operationIds: string[]) {
    return db.providerDecisionEvent.findMany({ where: { operationId: { in: operationIds } }, orderBy: [{ operationId: 'asc' }, { sequence: 'asc' }] });
  }

  /**
   * One page of the operations of open tasks that only a person can move (unknown, or succeeded with an exception
   * and not applied), newest first by the time the operation was recorded, which never changes: a row keeps its
   * place while the list is paged. `waiting` narrows it to the ones whose last decision step is a proposal
   * (`approval`) or to the others (`decision`). Answers ids only; `take` is the page size plus one.
   */
  async awaitingDecisionIds(db: Db, waiting: WaitingFor | undefined, position: { at: Date; id: string } | undefined, take: number): Promise<string[]> {
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT o."id" FROM "ProviderOperation" o JOIN "OfficeTask" t ON t."id" = o."taskId"
      WHERE ${AWAITS_PERSON} ${narrowed(waiting)}
        ${position ? Prisma.sql`AND (o."createdAt" < ${position.at} OR (o."createdAt" = ${position.at} AND o."id" < ${position.id}))` : Prisma.empty}
      ORDER BY o."createdAt" DESC, o."id" DESC LIMIT ${take}`;
    return rows.map((row) => row.id);
  }

  /** How many operations wait for a second approval and how many for a first decision: counted, never estimated from a page. */
  async awaitingDecisionCounts(db: Db): Promise<{ approval: number; decision: number }> {
    const rows = await db.$queryRaw<{ approval: bigint; decision: bigint }[]>`
      SELECT count(*) FILTER (WHERE ${OPEN_PROPOSAL}) AS "approval", count(*) FILTER (WHERE NOT ${OPEN_PROPOSAL}) AS "decision"
      FROM "ProviderOperation" o JOIN "OfficeTask" t ON t."id" = o."taskId" WHERE ${AWAITS_PERSON}`;
    return { approval: Number(rows[0]?.approval ?? 0), decision: Number(rows[0]?.decision ?? 0) };
  }

  /** These operations with their tasks' own columns, for the queue. What the provider handed back is not selected. */
  awaitingDecisionRows(db: Db, ids: string[]) {
    return db.providerOperation.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, status: true, appliedAt: true, applyError: true, createdAt: true, updatedAt: true,
        task: { select: { id: true, action: true, msisdn: true, held: true, posDelta: true, submitterId: true, createdAt: true, submitter: { select: { loginName: true } }, pos: { select: { loginName: true } }, package: { select: { name: true } } } },
      },
    });
  }

  /** Stamps a failed operation as handed to the branch, once. */
  async markHandedOver(db: Db, id: string, at: Date): Promise<boolean> {
    const marked = await db.providerOperation.updateMany({ where: { id, status: 'failed', appliedAt: null }, data: { appliedAt: at } });
    return marked.count === 1;
  }
}
