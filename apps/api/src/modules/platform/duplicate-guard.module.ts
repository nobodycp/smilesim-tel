import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DuplicateGuardInterceptor } from './duplicate-guard.interceptor';

/**
 * The duplicate-write guard, registered once for every route (`APP_INTERCEPTOR`). What it
 * guards and how: `duplicate-guard.interceptor.ts`.
 */
@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: DuplicateGuardInterceptor }],
})
export class DuplicateGuardModule {}
