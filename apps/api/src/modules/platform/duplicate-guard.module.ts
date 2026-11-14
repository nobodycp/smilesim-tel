import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DuplicateGuardInterceptor } from './duplicate-guard.interceptor';

/**
 * The duplicate-write guard, registered once for every route (`APP_INTERCEPTOR`). Slice R.9: the platform's, where
 * the umbrella `OfficeModule` registered it before; what it guards and how is unchanged (`duplicate-guard.interceptor.ts`).
 */
@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: DuplicateGuardInterceptor }],
})
export class DuplicateGuardModule {}
