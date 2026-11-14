import { UnitOfWork } from '../office/kernel/unit-of-work';
import 'reflect-metadata';
import { PrismaBrandingStore } from '../branding/prisma-branding.store';
import { PrismaActivityRecorder } from '../auditing/activity-recorder';
import type { NoticeService } from '../notifications/notice.service';
import { PrismaService } from './prisma.service';

// One process, one PostgreSQL pool: the services and stores take the client PrismaService holds.
describe('PrismaService', () => {
  const previous = process.env.DATABASE_URL;
  afterEach(() => {
    process.env.DATABASE_URL = previous;
  });

  it('is the one client the office, the activity log and the branding store read through', () => {
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:1/none';
    const shared = { marker: 'shared' };
    const db = { client: shared, available: true } as unknown as PrismaService;
    const notice = { write: async () => [], publish: async () => undefined } as unknown as NoticeService;

    const office = new UnitOfWork(notice, db);
    const activity = new PrismaActivityRecorder(db) as unknown as { client: () => unknown };
    const branding = new PrismaBrandingStore(db) as unknown as { prisma: unknown };

    expect(office.prisma).toBe(shared);
    expect(activity.client()).toBe(shared);
    expect(branding.prisma).toBe(shared);
  });

  it('opens no client until one is asked for, and closes only the one it opened', async () => {
    const service = new PrismaService();
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    process.env.DATABASE_URL = '';
    expect(service.available).toBe(false);
  });
});
