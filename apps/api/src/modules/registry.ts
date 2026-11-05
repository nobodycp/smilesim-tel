// apps/api/src/modules/registry.ts
import { AuthModule } from './auth/auth.module';
import { BrandingModule } from './branding/branding.module';
import { ActivityModule } from './office/activity.module';
import { OfficeModule } from './office/office.module';

// The extension contract requires `any[]` here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const featureModules: any[] = [ActivityModule, AuthModule, OfficeModule, BrandingModule];
