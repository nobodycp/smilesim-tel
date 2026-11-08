// apps/api/src/modules/registry.spec.ts
import { AuthModule } from './auth/auth.module';
import { BrandingModule } from './branding/branding.module';
import { ActivityModule } from './office/activity.module';
import { OfficeModule } from './office/office.module';
import { featureModules } from './registry';
import { PrismaModule } from './shared/prisma.service';

describe('featureModules', () => {
  it('registers every feature module', () => {
    expect(featureModules).toEqual([PrismaModule, ActivityModule, AuthModule, OfficeModule, BrandingModule]);
  });
});
