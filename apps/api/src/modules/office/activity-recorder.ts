import { Injectable } from '@nestjs/common';
import { createPrismaClient } from '../../db';
import { PrismaClient } from '../../generated/prisma/client';

export type ActivityDraft = {
  action: string;
  subjectKind?: string;
  subjectRef?: string;
};

type Gate = { sessionId?: string; homeId?: string };

@Injectable()
export class ActivityRecorder {
  private prismaClient: PrismaClient | null = null;

  private client(): PrismaClient | null {
    if (!process.env.DATABASE_URL) return null;
    this.prismaClient ??= createPrismaClient();
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
      console.error('activity log:', error instanceof Error ? error.message : error);
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
      console.error('activity log:', error instanceof Error ? error.message : error);
    }
  }

  private async actorFromGate(db: PrismaClient, gate: Gate): Promise<{ id: string; loginName: string; layer: string } | null> {
    if (!gate.sessionId) return null;
    const session = await db.session.findUnique({
      where: { id: gate.sessionId },
      include: { user: { select: { id: true, loginName: true, layer: true } } },
    });
    if (!session) return null;
    if (session.kind === 'impersonation' && gate.homeId) {
      const home = await db.session.findUnique({
        where: { id: gate.homeId },
        include: { user: { select: { id: true, loginName: true, layer: true } } },
      });
      if (home?.user) return home.user;
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
