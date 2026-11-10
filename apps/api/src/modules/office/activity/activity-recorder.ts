import { hashSessionToken } from '../../auth/session-token';
import { logger, reason as why } from '../../shared/log';
import { env } from '../../../config';
import { Injectable, Optional } from '@nestjs/common';
import { createPrismaClient } from '../../../db';
import { PrismaClient } from '../../../generated/prisma/client';
import { PrismaService } from '../../shared/prisma.service';

export type ActivityDraft = {
  action: string;
  subjectKind?: string;
  subjectRef?: string;
};

import type { Gate } from '../../shared/cookies';

const log = logger('ActivityLog');

@Injectable()
export class ActivityRecorder {
  private prismaClient: PrismaClient | null = null;

  constructor(@Optional() private readonly db?: PrismaService) {}

  private client(): PrismaClient | null {
    if (!env('DATABASE_URL')) return null;
    this.prismaClient ??= this.db?.client ?? createPrismaClient();
    return this.prismaClient;
  }

  async recordOffice(gate: Gate, ip: string, event: ActivityDraft, result: 'ok' | 'fail', reason: string): Promise<void> {
    const db = this.client();
    if (!db) return;
    try {
      const actor = await this.actorFromGate(db, gate);
      const subjectRef = await this.subjectRef(db, event);
      await db.activityEvent.create({
        data: {
          actorId: actor?.id ?? null,
          actorLogin: actor?.loginName ?? '',
          actorLayer: actor?.layer ?? '',
          action: event.action,
          result,
          reason: result === 'fail' ? reason : '',
          ip: ip ?? '',
          subjectKind: event.subjectKind ?? '',
          subjectRef,
        },
      });
    } catch (error) {
      log.error(why(error));
    }
  }

  async recordLogin(input: { loginName: string; ip: string; result: 'ok' | 'fail'; reason: string }): Promise<void> {
    const db = this.client();
    if (!db) return;
    try {
      const user = await db.user.findUnique({ where: { loginName: input.loginName }, select: { id: true, loginName: true, layer: true } });
      await db.activityEvent.create({
        data: {
          actorId: user?.id ?? null,
          actorLogin: input.loginName,
          actorLayer: user?.layer ?? '',
          action: 'login',
          result: input.result,
          reason: input.result === 'fail' ? input.reason : '',
          ip: input.ip ?? '',
          subjectKind: '',
          subjectRef: '',
        },
      });
    } catch (error) {
      log.error(why(error));
    }
  }

  private async actorFromGate(db: PrismaClient, gate: Gate): Promise<{ id: string; loginName: string; layer: string } | null> {
    if (!gate.sessionId) return null;
    const session = await db.session.findUnique({
      where: { tokenHash: hashSessionToken(gate.sessionId) },
      include: { user: { select: { id: true, loginName: true, layer: true } } },
    });
    if (!session) return null;
    // An entered session is recorded under the account that entered, as kept on the session (rule 3.5).
    if (session.kind === 'impersonation' && session.operatorId) {
      const operator = await db.user.findUnique({ where: { id: session.operatorId }, select: { id: true, loginName: true, layer: true } });
      if (operator) return operator;
    }
    return session.user;
  }

  private async subjectRef(db: PrismaClient, event: ActivityDraft): Promise<string> {
    const ref = event.subjectRef ?? '';
    if (event.subjectKind !== 'line' || !ref) return ref;
    const line = await db.line.findUnique({ where: { id: ref }, select: { msisdn: true } });
    return line?.msisdn ?? ref;
  }
}
