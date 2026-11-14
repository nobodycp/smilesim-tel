import type { Gate } from './cookies';

// The port every module records the activity log through (ADR 0020, slice R.2).
//
// The platform owns the port: the abstract `ActivityRecorder`, what an event says (`ActivityDraft`) and the actions
// an event may name. `modules/auditing` owns the one implementation (`PrismaActivityRecorder`, provided under this
// class by `ActivityModule`) and the reading of the log. So the controllers of every module, the activity
// interceptor and sign-in record without importing auditing, and auditing is free to read accounts and sessions.
// Nest resolves the abstract class as the token: `constructor(private readonly activity: ActivityRecorder)`.

export type ActivityDraft = {
  action: string;
  subjectKind?: string;
  subjectRef?: string;
};

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
  'provider_decision',
  'provider_dispatch_approve',
  'provider_dispatch_pause',
  'provider_dispatch_resume',
  'provider_credential',
  'provider_decision_approval',
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
  // An eSIM code was answered by a line's or a task's detail (ADR 0019, D17: `line.esim_read`).
  'esim_read',
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export abstract class ActivityRecorder {
  /** Records what a signed-in request did, `ok` or `fail` with the refusal code. A failure to write is logged, never thrown. */
  abstract recordOffice(gate: Gate, ip: string, event: ActivityDraft, result: 'ok' | 'fail', reason: string): Promise<void>;
  /**
   * Records an event that must exist before its answer leaves (the read of an eSIM code, ADR 0019 D17): a failure
   * to write is thrown, and the caller does not answer.
   */
  abstract recordOfficeOrFail(gate: Gate, ip: string, event: ActivityDraft): Promise<void>;
  /** Records a sign-in attempt by the login name it was made with. A failure to write is logged, never thrown. */
  abstract recordLogin(input: { loginName: string; ip: string; result: 'ok' | 'fail'; reason: string }): Promise<void>;
}
