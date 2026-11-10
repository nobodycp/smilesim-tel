import { AUTH_STORE, type AuthStore } from '../../auth/auth.store';
import { UnitOfWork } from '../kernel/unit-of-work';
import { Inject, Injectable } from '@nestjs/common';
import { feedPosition } from '../kernel/feed';
import type { Actor } from '../kernel/types';
import { NOTICE_GROUPS, noticeGroupOf } from './notice-kinds';
import { NEWEST_FIRST, NOTICES_PAGE, afterFeed, mergeFeed } from '../rules/office-paging';

/** The signed-in account's own notices: the paged inbox, marking read, and the live channel. */
@Injectable()
export class NoticeInboxService {
  constructor(private readonly uow: UnitOfWork, @Inject(AUTH_STORE) private readonly auth: AuthStore) {}

  async list(actor: Actor, query: { cursor?: string; group?: string; unread?: string } = {}) {
    const group = noticeGroupOf(query.group);
    const onlyUnread = query.unread === '1' || query.unread === 'true';
    const position = query.cursor ? feedPosition(query.cursor) : undefined;
    const where = {
      userId: actor.id,
      ...(group ? { kind: { in: [...NOTICE_GROUPS[group]] } } : {}),
      ...(onlyUnread ? { readAt: null } : {}),
    };
    const prisma = this.uow.prisma;
    const [rows, unread, total] = await Promise.all([
      prisma.notice.findMany({
        where: { ...where, AND: afterFeed(position) },
        orderBy: [...NEWEST_FIRST],
        take: NOTICES_PAGE + 1,
      }),
      prisma.notice.count({ where: { userId: actor.id, readAt: null } }),
      prisma.notice.count({ where }),
    ]);
    const { page, nextCursor } = mergeFeed([rows], NOTICES_PAGE);
    return {
      unread,
      total,
      notices: page.map((row) => ({
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
    await this.uow.prisma.notice.updateMany({
      where: { userId: actor.id, readAt: null, ...(id ? { id } : {}) },
      data: { readAt: new Date() },
    });
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
    return this.uow.notice.subscribe(actor.id, handler);
  }
}
