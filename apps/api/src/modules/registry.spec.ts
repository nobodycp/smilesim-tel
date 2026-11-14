// apps/api/src/modules/registry.spec.ts
import { AuthModule } from './auth/auth.module';
import { BrandingModule } from './branding/branding.module';
import { ActivityModule } from './auditing/activity.module';
import { NoticeWriterModule } from './notifications/notice-writer.module';
import { OfficeModule } from './office/office.module';
import { AccountTasksModule } from './tasks/account-tasks.module';
import { AccountWalletsModule } from './wallets/account-wallets.module';
import { featureModules } from './registry';
import { PrismaModule } from './platform/prisma.service';

describe('featureModules', () => {
  it('registers every feature module', () => {
    expect(featureModules).toEqual([PrismaModule, ActivityModule, NoticeWriterModule, AuthModule, OfficeModule, AccountWalletsModule, AccountTasksModule, BrandingModule]);
  });
});
