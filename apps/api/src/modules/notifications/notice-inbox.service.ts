import { NoticesQuery } from './notices.schemas';
import { parseInput } from '../shared/input';
import { AUTH_STORE, type AuthStore } from '../auth/auth.store';
import { NoticesRepository } from './notices.repository';
import { NoticeService } from './notice.service';
import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../office/kernel/types';
import { NOTICE_GROUPS, noticeGroupOf } from './notice-kinds';
import { after, cursorPosition, page } from '../shared/paging';
import { NOTICES_PAGE } from '../office/rules/office-paging';

/** The signed-in account's own notices: the paged inbox, marking read, and the live channel. */
@Injectable()
export class NoticeInboxService {
  constructor(private readonly repo: NoticesRepository, private readonly notice: NoticeService, @Inject(AUTH_STORE) private readonly auth: AuthStore) {}

  async list(actor: Actor, input: NoticesQuery = {}) {
    const query = parseInput(NoticesQuery, input);
    const group = noticeGroupOf(query.group);
    const onlyUnread = query.unread === '1' || query.unread === 'true';
    const position = cursorPosition(query.cursor);
    const where = {
      userId: actor.id,
      ...(group ? { kind: { in: [...NOTICE_GROUPS[group]] } } : {}),
      ...(onlyUnread ? { readAt: null } : {}),
    };
    const [rows, unread, total] = await Promise.all([
      this.repo.notices({ ...where, AND: after(position) }, NOTICES_PAGE + 1),
      this.repo.noticeCount({ userId: actor.id, readAt: null }),
      this.repo.noticeCount(where),
    ]);
    const { items, nextCursor } = page(rows, NOTICES_PAGE);
    return {
      unread,
      total,
      items: items.map((row) => ({
        id: row.id,
        kind: row.kind,
        payload: row.payload,
        actorName: row.actorName,
        href: row.href,
        read: Boolean(row.readAt),
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor,
    };
  }

  /** One notice by id, or every unread one when no id is given. */
  async read(actor: Actor, id?: string) {
    await this.repo.markRead(actor.id, id);
    return { ok: true as const };
  }

  /** Whether the session a stream was opened with is still live: not signed out, frozen, revoked or idle out. */
  async sessionLive(sessionId: string | undefined): Promise<boolean> {
    if (!sessionId) return false;
    const live = await this.auth.liveSession(sessionId).catch(() => null);
    return Boolean(live && !live.user.disabledAt);
  }

  /** One live channel per signed-in user. Resolves an unsubscribe function. */
  subscribe(actor: Actor, handler: (message: string) => void) {
    return this.notice.subscribe(actor.id, handler);
  }
}
