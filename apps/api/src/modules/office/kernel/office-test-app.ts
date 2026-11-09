import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AUTH_STORE, type AuthStore } from '../../auth/auth.store';
import { ActivityRecorder } from '../activity-recorder';
import { API_PROVIDERS } from '../../shared/api-providers';
import { NoticeService } from '../notice.service';
import { OFFICE_CONTROLLERS, OFFICE_PROVIDERS } from '../office.module';
import { OfficeKernel } from './office-kernel';

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
  moduleRef.get(OfficeKernel).prismaClient = tables as unknown as OfficeKernel['prismaClient'];
  const app: INestApplication = moduleRef.createNestApplication();
  await app.init();
  return { app, recorded };
}
