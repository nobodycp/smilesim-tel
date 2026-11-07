/** What the browser needs to word a notice. The API stores no sentence. */

import type { TransferKind } from './transfer-rules';

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

export type FundNoticePayload = { amount: number; senderName: string; note: string };
export type WalletNoticePayload = { balance: number; ceiling: number; attempted?: number; loginName: string };
export type AnnouncementNoticePayload = { announcementId: string; authorName: string; excerpt: string };
/**
 * A number, a point of sale, or an agent changed hands. `subject` is the msisdn or the login. The account that
 * lost it hears `transfer.out` with `toLogin`, the account that received it `transfer.in` with `fromLogin`.
 */
export type TransferNoticePayload = { kind: TransferKind; subject: string; fromLogin?: string; toLogin?: string; actorName: string };

export type NoticeDraft =
  | { kind: 'task.opened' | 'task.taken' | 'task.released' | 'task.note' | 'task.done' | 'task.rejected' | 'task.cancelled'; payload: TaskNoticePayload }
  | { kind: 'fund.received'; payload: FundNoticePayload }
  | { kind: 'wallet.negative' | 'wallet.ceiling'; payload: WalletNoticePayload }
  | { kind: 'transfer.out' | 'transfer.in'; payload: TransferNoticePayload }
  | { kind: 'announcement'; payload: AnnouncementNoticePayload };

export type NoticeKind = NoticeDraft['kind'];

export const NOTICE_GROUPS = {
  tasks: ['task.opened', 'task.taken', 'task.released', 'task.note', 'task.done', 'task.rejected', 'task.cancelled'],
  wallet: ['fund.received', 'wallet.negative', 'wallet.ceiling', 'transfer.out', 'transfer.in'],
  announcements: ['announcement'],
} as const satisfies Record<string, readonly NoticeKind[]>;

export type NoticeGroup = keyof typeof NOTICE_GROUPS;

export function noticeGroupOf(value: unknown): NoticeGroup | null {
  return value === 'tasks' || value === 'wallet' || value === 'announcements' ? value : null;
}

/** The record a notice opens. */
export function hrefFor(draft: NoticeDraft): string {
  if (draft.kind.startsWith('task.')) return `/tasks/${(draft.payload as TaskNoticePayload).taskId}`;
  if (draft.kind === 'announcement') return '/';
  if (draft.kind === 'transfer.out' || draft.kind === 'transfer.in') return '/users';
  return '/finance';
}

export const EXCERPT_LENGTH = 120;

export function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= EXCERPT_LENGTH ? flat : `${flat.slice(0, EXCERPT_LENGTH - 1)}…`;
}
