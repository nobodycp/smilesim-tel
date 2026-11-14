import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformModule } from '../platform/platform.module';
import { AccountTree } from './account-tree';
import { ActorResolver } from './actor-resolver';

/**
 * Access: the account tree and the signed-in actor (the actor interceptor on every controller resolves through
 * `ActorResolver`). It reads sessions through the auth store, so it imports `AuthModule`; it hands on nothing of
 * it: a module that injects the auth store imports `AuthModule` itself. Transactions are the platform's
 * (`PlatformModule`). Slice R.3: this and `PlatformModule` replace the kernel module, which held both.
 */
export const ACCESS_MODULE_PROVIDERS = [AccountTree, ActorResolver];

@Module({
  imports: [PlatformModule, AuthModule],
  providers: ACCESS_MODULE_PROVIDERS,
  exports: ACCESS_MODULE_PROVIDERS,
})
export class AccessModule {}
