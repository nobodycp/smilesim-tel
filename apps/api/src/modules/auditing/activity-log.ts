export const ACTIVITY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

// The actions an event may name are the platform's (`shared/activity.ts`): every module records through the port.
export { ACTIVITY_ACTIONS, type ActivityAction } from '../shared/activity';

export function purgeBefore(now: Date = new Date()): Date {
  return new Date(now.getTime() - ACTIVITY_RETENTION_MS);
}

/**
 * The worker's daily purge: activity events older than the retention window, and nothing else. The permanent
 * record of decisions on provider operations (`ProviderDecisionEvent`, ADR 0019 D15) is another table, which this
 * never names; the database refuses a delete there in any case. Answers how many events were removed.
 */
export async function purgeActivity(db: { activityEvent: { deleteMany: (args: { where: { at: { lt: Date } } }) => Promise<{ count: number }> } }, now: Date = new Date()): Promise<number> {
  return (await db.activityEvent.deleteMany({ where: { at: { lt: purgeBefore(now) } } })).count;
}

/** Dates outside the retention window are pulled back inside it. */
export function clampActivityRange(from: Date | null, to: Date | null, now: Date = new Date()): { gte: Date; lte: Date } {
  const start = purgeBefore(now);
  const gte = !from || Number.isNaN(from.getTime()) || from < start ? start : from;
  let lte = !to || Number.isNaN(to.getTime()) || to > now ? now : to;
  if (lte < gte) lte = gte;
  return { gte, lte };
}

/**
 * Branch sees every row, including unknown-login failures (`actorId` null).
 * Any other layer sees rows whose actor is in `visibleIds` only.
 */
export function activityActorFilter(layer: string, visibleIds: string[]): { actorId?: { in: string[] } | null; OR?: Array<{ actorId: { in: string[] } | null }> } {
  if (layer === 'branch') return {};
  return { actorId: { in: visibleIds } };
}
