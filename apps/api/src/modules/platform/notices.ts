import type { Prisma } from '../../generated/prisma/client';

// What a notice is, and the port through which a transaction writes and announces one (ADR 0020, slice R.2).
//
// The platform owns the port; `modules/notifications` owns the one implementation (`NoticeService`). The unit of
// work holds the port and never the implementation, so the platform imports nothing of notifications. Like the
// error codes of `errors.ts`, the list of notice kinds is a contract every module writes against: it is here,
// beside the port, and holds types only.
//
// The two steps stay apart and in the order they always had:
//   1. `write` inserts the rows through the caller's transaction client: a rollback takes them back.
//   2. `publish` pushes the rows written to the live channel; the unit of work calls it only after the
//      transaction committed (`runTx`), and a failure there is logged, never thrown (`publishQuietly`).

// ── The kinds and what each carries (what the browser needs to word a notice; the API stores no sentence) ──

export type TaskNoticePayload = {
  taskId: string;
  action: string;
  msisdn: string | null;
  packageName?: string;
  amount?: number;
  handlerName?: string;
  authorName?: string;
  excerpt?: string;
  reason?: string;
};

export type FundNoticePayload = { amount: number; senderName: string; note: string; reason?: string };
export type WalletNoticePayload = { balance: number; ceiling: number; attempted?: number; loginName: string };
/**
 * A number, a point of sale, or an agent changed hands. `subject` is the msisdn or the login. The account that
 * lost it hears `transfer.out` with `toLoginName`, the account that received it `transfer.in` with `fromLoginName`.
 * `kind` is a transfer's kind (`transfers/transfer-rules.ts` `TransferKind`; a spec keeps the two equal).
 */
export type TransferNoticePayload = { kind: 'line' | 'pos' | 'agent'; subject: string; fromLoginName?: string; toLoginName?: string; actorName: string };

/** A provider turned to a problem, or recovered (spec 2026-11-08-overview-and-reports-nav, G). */
export type ProviderNoticePayload = { code: string; name: string; reason: 'failures' | 'balance' | null; failures: number; available: number; alertFloor: number };

/** A statement provider was not matched within its period (spec 2026-11-08-overview-and-reports-nav, E). */
export type MatchOverduePayload = { code: string; name: string; matchEveryDays: number; lastMatchedAt: string | null };

export type NoticeDraft =
  | { kind: 'task.opened' | 'task.taken' | 'task.released' | 'task.note' | 'task.done' | 'task.rejected' | 'task.cancelled'; payload: TaskNoticePayload }
  | { kind: 'fund.received' | 'fund.deducted'; payload: FundNoticePayload }
  | { kind: 'wallet.negative' | 'wallet.ceiling'; payload: WalletNoticePayload }
  | { kind: 'transfer.out' | 'transfer.in'; payload: TransferNoticePayload }
  | { kind: 'provider.problem' | 'provider.recovered'; payload: ProviderNoticePayload }
  | { kind: 'provider.match_overdue'; payload: MatchOverduePayload };

export type NoticeKind = NoticeDraft['kind'];

// ── A written notice ────────────────────────────────────────────────────────────────────────────────────────

/** What a browser receives: the same shape the list endpoint returns. */
export type NoticeView = {
  id: string;
  kind: string;
  payload: unknown;
  actorName: string;
  href: string;
  read: boolean;
  createdAt: string;
};

/** A notice as it was written for one account: what is published to that account's channel after the commit. */
export type WrittenNotice = NoticeView & { userId: string };

/** The account a notice is from. */
export type NoticeActor = { id: string; nickname: string };

// ── The port ────────────────────────────────────────────────────────────────────────────────────────────────

export interface NoticeWriter {
  /**
   * Writes one notice for each recipient through `tx` and answers what was written. The account the notice is
   * from is left out of its own audience unless `tellActor` says otherwise.
   */
  write(tx: Prisma.TransactionClient, userIds: string[], actor: NoticeActor, draft: NoticeDraft, options?: { tellActor?: boolean }): Promise<WrittenNotice[]>;
  /** Pushes notices already committed to their accounts' live channels. */
  publish(rows: WrittenNotice[]): Promise<void>;
}

/** The token the notice writer is provided under (`modules/notifications/notice-writer.module.ts`). */
export const NOTICE_WRITER = Symbol('NOTICE_WRITER');
