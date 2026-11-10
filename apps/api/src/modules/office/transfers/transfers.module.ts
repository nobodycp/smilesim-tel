import { KernelModule } from '../kernel/kernel.module';
import { LinesModule } from '../lines/lines.module';
import { TermsModule } from '../terms/terms.module';
import { WalletsModule } from '../wallets/wallets.module';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';
import { Module } from '@nestjs/common';

/** Moving an account or a number to another parent. */
export const TRANSFERS_CONTROLLERS = [TransfersController];
export const TRANSFERS_PROVIDERS = [TransfersService];

@Module({
  imports: [KernelModule, TermsModule, LinesModule, WalletsModule],
  controllers: TRANSFERS_CONTROLLERS,
  providers: TRANSFERS_PROVIDERS,
  exports: [],
})
export class TransfersModule {}
