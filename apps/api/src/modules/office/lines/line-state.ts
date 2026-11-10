import type { Prisma } from '../../../generated/prisma/client';
import { fail } from '../../shared/office-failure';
import { isUniqueViolation } from '../../shared/prisma-errors';
import type { Action } from '../kernel/types';

// The state of a line inside a transaction (backend-engineering.mdc, 2). What was read before the transaction is
// not trusted: the row is locked, read again and checked, so two operations on one number run one after the other
// and the second sees what the first did.

export type LineStatus = 'active' | 'frozen' | 'disconnected';

/**
 * The statuses a line may be in for a deferred operation to apply when its task is completed. A task whose line
 * moved on (disconnected meanwhile, already unfrozen) is refused and can only be rejected.
 */
const STATUS_FOR_TASK: Record<Exclude<Action, 'activate'>, readonly LineStatus[]> = {
  disconnect: ['active'],
  freeze: ['active'],
  unfreeze: ['frozen'],
  extend: ['active'],
  charge: ['disconnected'],
  reactivate: ['disconnected'],
  switch: ['active'],
  rename: ['active', 'frozen'],
  sim: ['active', 'frozen'],
  esim: ['active', 'frozen'],
  refresh: ['active', 'frozen'],
  addon: ['active', 'frozen'],
};

/** Holds the line's row until the transaction ends. Always before any wallet lock (rule 1.4). */
export async function lockLine(tx: Prisma.TransactionClient, lineId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Line" WHERE "id" = ${lineId} FOR UPDATE`;
}

/** Serialises every transaction that names the same key (a SIM serial has no row of its own to lock). */
export async function lockKey(tx: Prisma.TransactionClient, key: string): Promise<void> {
  // The function returns `void`, which the client cannot read back: cast it to text.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS locked`;
}

/** Refuses a task whose line is no longer in a state its action applies to. A locked switch is still a switch. */
export function assertTaskFits(action: Action, line: { status: string; opsLocked: boolean }): void {
  if (action === 'activate') return;
  if (action === 'switch' && line.opsLocked) return;
  if (!STATUS_FOR_TASK[action].includes(line.status as LineStatus)) fail(400, 'INVALID');
}

type Fingerprint = { status: string; endsAt: Date; packageId: string; posId: string; opsLocked: boolean; msisdn: string; iccid: string | null };

/** Whether the line under the lock is the line the request was checked against. */
export function unchanged(before: Fingerprint, now: Fingerprint): boolean {
  return (
    before.status === now.status &&
    before.endsAt.getTime() === now.endsAt.getTime() &&
    before.packageId === now.packageId &&
    before.posId === now.posId &&
    before.opsLocked === now.opsLocked &&
    before.msisdn === now.msisdn &&
    before.iccid === now.iccid
  );
}

/**
 * First statement of a transaction that changes a line the request already validated: locks the row and refuses
 * with 409 when another operation changed the line in between (a double click, two sessions on one number).
 */
export async function lockUnchanged(tx: Prisma.TransactionClient, before: Fingerprint & { id: string }): Promise<void> {
  await lockLine(tx, before.id);
  const now = await tx.line.findUnique({ where: { id: before.id } });
  if (!now || !unchanged(before, now)) fail(409, 'DUPLICATE_REQUEST');
}

/** The task's line, locked and read with its package, or nothing when the task has no line. */
export async function lockedTaskLine(tx: Prisma.TransactionClient, action: Action, lineId: string) {
  await lockLine(tx, lineId);
  const line = await tx.line.findUnique({ where: { id: lineId }, include: { package: { include: { company: true, provider: true } } } });
  if (!line) fail(400, 'INVALID');
  assertTaskFits(action, line);
  return line;
}

/** The one way a line changes status: only from a status the caller names, or the write is refused (rule 2.1). */
export async function moveLineStatus(
  tx: Prisma.TransactionClient,
  lineId: string,
  from: readonly LineStatus[],
  to: LineStatus,
  data: Omit<Prisma.LineUncheckedUpdateManyInput, 'status'> = {},
): Promise<void> {
  const changed = await tx.line.updateMany({ where: { id: lineId, status: { in: [...from] } }, data: { ...data, status: to } });
  if (changed.count !== 1) fail(400, 'INVALID');
}

/**
 * A SIM serial belongs to one live number. Serialised on the serial itself, so two activations of the same card
 * cannot both pass the check. A disconnected number gives its card back.
 */
export async function assertSimFree(tx: Prisma.TransactionClient, iccid: string, exceptLineId?: string): Promise<void> {
  await lockKey(tx, `iccid:${iccid}`);
  const holder = await tx.line.findFirst({
    where: { iccid, status: { not: 'disconnected' }, ...(exceptLineId ? { id: { not: exceptLineId } } : {}) },
    select: { id: true },
  });
  if (holder) fail(409, 'SIM_TAKEN');
}

/**
 * A write that hit the unique number: two requests for one number at the same moment, and the database let one
 * through. For `.catch()` on the write, whether it runs now or when a task is completed: 409, and the transaction
 * it ran in is rolled back.
 */
export const numberTaken = (error: unknown) => (isUniqueViolation(error) ? fail(409, 'NUMBER_TAKEN') : Promise.reject(error));
