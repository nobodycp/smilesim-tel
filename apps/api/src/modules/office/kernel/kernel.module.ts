import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { AccountTree } from './account-tree';
import { ActorResolver } from './actor-resolver';
import { UnitOfWork } from './unit-of-work';

/**
 * What every office domain may use: the database and its transactions, the account tree and the signed-in actor.
 * It also hands on what `AuthModule` exports (the auth store), which the interceptors on every office controller
 * need. The notice writer and the activity recorder are the platform's ports, provided by the global modules of
 * notifications and auditing (slice R.2). Each domain module imports this one by name; it is not global.
 */
export const KERNEL_MODULE_PROVIDERS = [UnitOfWork, AccountTree, ActorResolver];

@Module({
  imports: [AuthModule],
  providers: KERNEL_MODULE_PROVIDERS,
  exports: [...KERNEL_MODULE_PROVIDERS, AuthModule],
})
export class KernelModule {}
