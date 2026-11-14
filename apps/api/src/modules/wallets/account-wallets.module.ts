import { Global, Module } from '@nestjs/common';
import { AccountWallets } from '../access/account-ports';
import { WalletLedger } from './wallet-ledger';
import { WalletsModule } from './wallets.module';

/**
 * The wallets' side of access's `AccountWallets` port (slice R.8): `WalletLedger` under the port, one instance, so
 * removing an account locks its wallet with the ledger's own `lockWallets`. Global, so access imports no wallets.
 */
export const ACCOUNT_WALLETS_PROVIDERS = [{ provide: AccountWallets, useExisting: WalletLedger }];

@Global()
@Module({
  imports: [WalletsModule],
  providers: ACCOUNT_WALLETS_PROVIDERS,
  exports: [AccountWallets],
})
export class AccountWalletsModule {}
