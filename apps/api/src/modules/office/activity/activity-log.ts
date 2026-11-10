export const ACTIVITY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export const ACTIVITY_ACTIONS = [
  'login',
  'logout',
  'password',
  'two_factor',
  'passkey_add',
  'passkey_remove',
  'user_create',
  'user_freeze',
  'user_restore',
  'user_delete',
  'user_transfer',
  'access',
  'enter',
  'leave',
  'fund',
  'deduct',
  'provider_payment',
  'provider_credit',
  'provider_reconcile',
  'provider_reconcile_item',
  'activate',
  'charge',
  'extend',
  'reactivate',
  'disconnect',
  'freeze',
  'unfreeze',
  'switch',
  'rename',
  'sim',
  'task_take',
  'task_release',
  'task_note',
  'task_complete',
  'task_reject',
  'task_cancel',
  'provider_mode',
  'company_sim',
  'package_mode',
  'package_price',
  'package_chain',
  'package_details',
  'package_reprice',
  'user_package',
  'user_ops',
  'sell_price',
  // Registered 2026-11-10: every name a route logs under is listed, and `Activity()` takes only these.
  'addon',
  'ceiling',
  'company_add',
  'company_image',
  'company_switch',
  'esim',
  'offer',
  'package_add',
  'package_addon',
  'package_renewals',
  'package_switches',
  'provider_esim_price',
  'provider_matching',
  'provider_statement',
  'refresh',
  'role_save',
  'transfer',
  'session_rules',
  'user_contact',
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export function purgeBefore(now: Date = new Date()): Date {
  return new Date(now.getTime() - ACTIVITY_RETENTION_MS);
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
