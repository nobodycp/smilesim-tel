import { AccountsRepository } from './accounts.repository';
import { AccessModule } from '../access.module';
import { PlatformModule } from '../../platform/platform.module';
import { AuthModule } from '../../auth/auth.module';
import { AccountSessionController } from './account-session.controller';
import { AccountSessionService } from './account-session.service';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { Module } from '@nestjs/common';

/** Accounts: the list, creating, freezing, removing, entering and leaving. */
export const ACCOUNTS_CONTROLLERS = [AccountsController, AccountSessionController];
export const ACCOUNTS_PROVIDERS = [AccountsRepository, AccountsService, AccountSessionService];

@Module({
  imports: [PlatformModule, AccessModule, AuthModule],
  controllers: ACCOUNTS_CONTROLLERS,
  providers: ACCOUNTS_PROVIDERS,
  exports: [],
})
export class AccountsModule {}
