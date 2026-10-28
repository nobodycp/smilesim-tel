// apps/api/src/modules/registry.ts
import type { Type } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';

export const featureModules: Type<unknown>[] = [AuthModule];
