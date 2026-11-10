import { AccountsRepository } from './accounts.repository';
import { KernelModule } from '../kernel/kernel.module';
import { RolesModule } from '../roles/roles.module';
import { WalletsModule } from '../wallets/wallets.module';
import { AccountSessionController } from './account-session.controller';
import { AccountSessionService } from './account-session.service';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { Module } from '@nestjs/common';

/** Accounts: the list, creating, freezing, removing, entering and leaving. */
export const ACCOUNTS_CONTROLLERS = [AccountsController, AccountSessionController];
export const ACCOUNTS_PROVIDERS = [AccountsRepository, AccountsService, AccountSessionService];

@Module({
  imports: [KernelModule, RolesModule, WalletsModule],
  controllers: ACCOUNTS_CONTROLLERS,
  providers: ACCOUNTS_PROVIDERS,
  exports: [],
})
export class AccountsModule {}
