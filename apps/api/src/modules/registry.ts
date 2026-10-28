// apps/api/src/modules/registry.ts
import { AuthModule } from './auth/auth.module';

// The extension contract requires `any[]` here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const featureModules: any[] = [AuthModule];
