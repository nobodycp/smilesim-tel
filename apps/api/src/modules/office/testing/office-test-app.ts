import { UnitOfWork } from '../kernel/unit-of-work';
import { INestApplication, type NestInterceptor } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AUTH_STORE, type AuthStore } from '../../auth/auth.store';
import { ActivityRecorder } from '../activity/activity-recorder';
import { API_PROVIDERS } from '../../shared/api-providers';
import { NoticeService } from '../notices/notice.service';
import { PROVIDER_GATEWAY, type ProviderGateway } from '../providers/gateway/provider-gateway';
import { OFFICE_CONTROLLERS, OFFICE_PROVIDERS } from '../office.module';

/**
 * For HTTP specs: every office route, as the app serves it, over the given auth store and in-memory tables.
 * Activity events land in `recorded`; notices are written and published through `notice` when given. `global`
 * interceptors run in front of every route, as `OfficeModule` registers the duplicate guard. `gateway` replaces the
 * provider gateway for the spec.
 */
export async function officeTestApp(store: AuthStore, tables: Record<string, unknown>, notice?: Partial<NoticeService>, global: NestInterceptor[] = [], gateway?: ProviderGateway) {
  const recorded: unknown[][] = [];
  let builder = Test.createTestingModule({
    controllers: OFFICE_CONTROLLERS,
    providers: [
      ...OFFICE_PROVIDERS,
      ...API_PROVIDERS,
      { provide: AUTH_STORE, useValue: store },
      {
        provide: ActivityRecorder,
        useValue: {
          recordOffice: async (...args: unknown[]) => void recorded.push(args),
          // The read of an eSIM code: same shape in `recorded`, always `ok`. A spec replaces it to make it fail.
          recordOfficeOrFail: async (...args: unknown[]) => void recorded.push([...args, 'ok', '']),
        },
      },
    ],
  });
  if (notice) builder = builder.overrideProvider(NoticeService).useValue(notice);
  // A spec may stand in for the provider gateway (the scripted one). The application itself binds the simulated
  // gateway and nothing else (`provider-dispatch-off.spec.ts`).
  if (gateway) builder = builder.overrideProvider(PROVIDER_GATEWAY).useValue(gateway);
  const moduleRef = await builder.compile();
  moduleRef.get(UnitOfWork).prismaClient = tables as unknown as UnitOfWork['prismaClient'];
  const app: INestApplication = moduleRef.createNestApplication();
  if (global.length) app.useGlobalInterceptors(...global);
  await app.init();
  return { app, recorded };
}
