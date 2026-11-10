import type { Action } from '../kernel/types';

// Who holds a SIM serial and a number (ADR 0019, D5). Pure: no Nest, no Prisma.
//
// A live line owns its serial, and every line owns its number. An open activation task reserves the serial and
// the number it was opened with, until it leaves `working`. Nothing else reserves: a SIM-swap or rename task
// names what it will take and takes it only when it is completed.

/** What one transaction is about to take. An empty part takes nothing. */
export type Claim = { iccid?: string | null; msisdn?: string | null };

/**
 * The keys a transaction locks before it reads who holds a serial or a number, in the one order every
 * transaction uses (the serial, then the number), so two of them never wait on each other in a circle. They are
 * taken after the task and the line rows and before any wallet (ADR 0019, lock order).
 */
export function claimKeys(claim: Claim): string[] {
  return [...(claim.iccid ? [`iccid:${claim.iccid}`] : []), ...(claim.msisdn ? [`msisdn:${claim.msisdn}`] : [])];
}

/** Whether a task is a reservation. The database's partial unique indexes use the same condition. */
export function reserves(task: { action: string; status: string }): boolean {
  return task.action === 'activate' && task.status === 'working';
}

/** Who was found holding what a claim asks for. */
export type Holders = { serialOnLine: boolean; serialOnTask: boolean; numberOnLine: boolean; numberOnTask: boolean };

/** The refusal for a claim that is held, the serial first; null when both are free. */
export function refusalOf(holders: Holders): 'SIM_TAKEN' | 'NUMBER_TAKEN' | null {
  if (holders.serialOnLine || holders.serialOnTask) return 'SIM_TAKEN';
  if (holders.numberOnLine || holders.numberOnTask) return 'NUMBER_TAKEN';
  return null;
}

/**
 * What finishing a task will put on a line: an activation its serial (the one handed back for an eSIM) and its
 * number, a SIM swap its serial, an eSIM issue the serial handed back, a rename the number handed back.
 */
export function completionClaim(task: { action: string; esim: boolean; iccid: string | null; msisdn: string | null }, handed: { iccid?: string; msisdn?: string }): Claim {
  const action = task.action as Action;
  if (action === 'activate') return { iccid: task.esim ? handed.iccid ?? null : task.iccid, msisdn: task.msisdn };
  if (action === 'sim') return { iccid: task.iccid };
  if (action === 'esim') return { iccid: handed.iccid ?? null };
  if (action === 'rename') return { msisdn: handed.msisdn ?? null };
  return {};
}
