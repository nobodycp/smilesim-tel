// How a task's money is settled when the branch completes it (ADR 0019, D10). Pure: no Nest, no Prisma.
//
// The owner's rule (2026-11-10): a package switch and a disconnect are valued on the day they are actually carried
// out. Both are the worth of the days still left, and a task may wait for days, so neither amount is fixed when
// the task opens. Every other operation charges the price fixed at opening.

/** What the rule reads of a task. */
export type ChargedTask = { action: string; posDelta: number; held: number | null };

/**
 * - `requote`: the amount is worked out again when the task is completed, on purpose: a package switch, whose
 *   difference shrinks with every day that passes while the task waits. The task's hold is what was quoted when
 *   it opened; the handler settles the new amount against it (`requotedSettlement`).
 * - `own`: the handler posts a credit worked out at completion, on purpose, and the task holds nothing: a
 *   disconnect's refund, which is the value of the days left on the day it is carried out.
 * - `none`: the task moves no money.
 * - `capture`: the task carries a debit fixed when it opened and holds exactly that: the hold becomes the charge,
 *   with no second ceiling check.
 * - `debit`: a debit with no hold behind it, or with a hold of another size (a task opened before holds existed):
 *   released, then debited with the ceiling check, as before. A credit carried by a task is posted the same way.
 */
export type TaskCharge = 'requote' | 'own' | 'none' | 'capture' | 'debit';

export function taskCharge(task: ChargedTask): TaskCharge {
  if (task.action === 'switch') return 'requote';
  if (task.action === 'disconnect') return 'own';
  if (task.posDelta === 0) return 'none';
  const held = task.held ?? 0;
  return task.posDelta < 0 && held > 0 && held === -task.posDelta ? 'capture' : 'debit';
}

/** Whether the task's hold is still needed when its handler runs: it is settled there, not given back first. */
export function keepsHoldForHandler(task: ChargedTask): boolean {
  const how = taskCharge(task);
  return how === 'capture' || how === 'requote';
}

/**
 * How an amount worked out at completion meets the hold taken at opening:
 * - a debit is captured against the hold: covered up to the hold, the excess checked as new money, and whatever
 *   the hold has beyond the debit given back;
 * - a credit or nothing owed: the hold is given back whole, and the credit, if any, is posted.
 */
export type RequotedSettlement = { by: 'capture'; held: number; amount: number } | { by: 'release'; held: number; credit: number };

export function requotedSettlement(held: number | null, amount: number): RequotedSettlement {
  const hold = Math.max(0, held ?? 0);
  return amount < 0 ? { by: 'capture', held: hold, amount } : { by: 'release', held: hold, credit: amount };
}
