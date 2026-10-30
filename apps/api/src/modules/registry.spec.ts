// apps/api/src/modules/registry.spec.ts
import { AuthModule } from './auth/auth.module';
import { OfficeModule } from './office/office.module';
import { featureModules } from './registry';

describe('featureModules', () => {
  it('registers AuthModule', () => {
    expect(featureModules).toEqual([AuthModule, OfficeModule]);
  });
});
