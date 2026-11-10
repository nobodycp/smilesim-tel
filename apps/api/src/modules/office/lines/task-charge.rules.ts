// How a task's money is settled when the branch completes it (ADR 0019, D10). Pure: no Nest, no Prisma.

/** What the rule reads of a task. */
export type ChargedTask = { action: string; posDelta: number; held: number | null };

/**
 * - `own`: the handler posts its own amount, worked out at completion (a disconnect's refund, a switch's
 *   difference). The task's hold, if any, is released first, as before.
 * - `none`: the task moves no money.
 * - `capture`: the task carries a debit fixed when it opened and holds exactly that: the hold becomes the charge,
 *   with no second ceiling check.
 * - `debit`: a debit with no hold behind it, or with a hold of another size (a task opened before holds existed):
 *   released, then debited with the ceiling check, as before. A credit carried by a task is posted the same way.
 */
export type TaskCharge = 'own' | 'none' | 'capture' | 'debit';

export function taskCharge(task: ChargedTask): TaskCharge {
  if (task.action === 'disconnect' || task.action === 'switch') return 'own';
  if (task.posDelta === 0) return 'none';
  const held = task.held ?? 0;
  return task.posDelta < 0 && held > 0 && held === -task.posDelta ? 'capture' : 'debit';
}
