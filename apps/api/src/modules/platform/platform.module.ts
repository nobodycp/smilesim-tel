import { Module } from '@nestjs/common';
import { UnitOfWork } from './unit-of-work';

/**
 * The database and its transactions (`UnitOfWork`), for every module that reads or writes. The notice writer it
 * holds is the platform's port, provided by the global module of notifications (slice R.2). Not global: each
 * module imports it by name. Slice R.3.
 */
export const PLATFORM_MODULE_PROVIDERS = [UnitOfWork];

@Module({
  providers: PLATFORM_MODULE_PROVIDERS,
  exports: PLATFORM_MODULE_PROVIDERS,
})
export class PlatformModule {}
