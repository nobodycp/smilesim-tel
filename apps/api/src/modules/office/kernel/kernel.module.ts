import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { NoticeService } from '../notices/notice.service';
import { AccountTree } from './account-tree';
import { ActorResolver } from './actor-resolver';
import { UnitOfWork } from './unit-of-work';

/**
 * What every office domain may use: the database and its transactions, the account tree, the signed-in actor and
 * the notice writer. It also hands on what `AuthModule` exports (the auth store and the activity recorder), which
 * the interceptors on every office controller need. Each domain module imports it by name; it is not global.
 */
export const KERNEL_MODULE_PROVIDERS = [NoticeService, UnitOfWork, AccountTree, ActorResolver];

@Module({
  imports: [AuthModule],
  providers: KERNEL_MODULE_PROVIDERS,
  exports: [...KERNEL_MODULE_PROVIDERS, AuthModule],
})
export class KernelModule {}
