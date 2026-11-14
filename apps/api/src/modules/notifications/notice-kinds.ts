/** What the browser needs to word a notice. The API stores no sentence. */

import type { NoticeDraft, NoticeKind, ProviderNoticePayload, TaskNoticePayload } from '../shared/notices';

// The kinds and their payloads are the platform's contract (`shared/notices.ts`); re-exported for the code that
// read them here.
export type { FundNoticePayload, MatchOverduePayload, NoticeDraft, NoticeKind, ProviderNoticePayload, TaskNoticePayload, TransferNoticePayload, WalletNoticePayload } from '../shared/notices';

export const NOTICE_GROUPS = {
  tasks: ['task.opened', 'task.taken', 'task.released', 'task.note', 'task.done', 'task.rejected', 'task.cancelled'],
  wallet: ['fund.received', 'fund.deducted', 'wallet.negative', 'wallet.ceiling', 'transfer.out', 'transfer.in'],
  providers: ['provider.problem', 'provider.recovered', 'provider.match_overdue'],
} as const satisfies Record<string, readonly NoticeKind[]>;

export type NoticeGroup = keyof typeof NOTICE_GROUPS;

export function noticeGroupOf(value: unknown): NoticeGroup | null {
  return value === 'tasks' || value === 'wallet' || value === 'providers' ? value : null;
}

/** The record a notice opens. */
export function hrefFor(draft: NoticeDraft): string {
  if (draft.kind.startsWith('task.')) return `/tasks/${(draft.payload as TaskNoticePayload).taskId}`;
  if (draft.kind === 'transfer.out' || draft.kind === 'transfer.in') return '/users';
  if (draft.kind === 'provider.match_overdue') return `/provider-accounts/${encodeURIComponent(draft.payload.code)}`;
  if (draft.kind === 'provider.problem' || draft.kind === 'provider.recovered') return `/provider-accounts/${encodeURIComponent((draft.payload as ProviderNoticePayload).code)}`;
  return '/finance';
}

export const EXCERPT_LENGTH = 120;

export function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= EXCERPT_LENGTH ? flat : `${flat.slice(0, EXCERPT_LENGTH - 1)}…`;
}
