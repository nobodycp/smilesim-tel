import { UnitOfWork } from '../kernel/unit-of-work';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AUTH_STORE, type AuthStore } from '../../auth/auth.store';
import { ActivityRecorder } from '../activity/activity-recorder';
import { API_PROVIDERS } from '../../shared/api-providers';
import { NoticeService } from '../notices/notice.service';
import { OFFICE_CONTROLLERS, OFFICE_PROVIDERS } from '../office.module';

/**
 * For HTTP specs: every office route, as the app serves it, over the given auth store and in-memory tables.
 * Activity events land in `recorded`; notices are written and published through `notice` when given.
 */
export async function officeTestApp(store: AuthStore, tables: Record<string, unknown>, notice?: Partial<NoticeService>) {
  const recorded: unknown[][] = [];
  let builder = Test.createTestingModule({
    controllers: OFFICE_CONTROLLERS,
    providers: [
      ...OFFICE_PROVIDERS,
      ...API_PROVIDERS,
      { provide: AUTH_STORE, useValue: store },
      { provide: ActivityRecorder, useValue: { recordOffice: async (...args: unknown[]) => void recorded.push(args) } },
    ],
  });
  if (notice) builder = builder.overrideProvider(NoticeService).useValue(notice);
  const moduleRef = await builder.compile();
  moduleRef.get(UnitOfWork).prismaClient = tables as unknown as UnitOfWork['prismaClient'];
  const app: INestApplication = moduleRef.createNestApplication();
  await app.init();
  return { app, recorded };
}
