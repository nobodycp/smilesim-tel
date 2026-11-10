import { WalletsRepository } from './wallets.repository';
import { KernelModule } from '../kernel/kernel.module';
import { TermsModule } from '../terms/terms.module';
import { WalletLedger } from './wallet-ledger';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';
import { Module } from '@nestjs/common';

/** Wallets: the ledger that moves money, funding, ceilings, the finance reads. */
export const WALLETS_CONTROLLERS = [WalletsController];
export const WALLETS_PROVIDERS = [WalletsRepository, WalletsService, WalletLedger];

@Module({
  imports: [KernelModule, TermsModule],
  controllers: WALLETS_CONTROLLERS,
  providers: WALLETS_PROVIDERS,
  exports: [WalletsService, WalletLedger],
})
export class WalletsModule {}
