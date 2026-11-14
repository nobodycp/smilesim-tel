import { TransfersRepository } from './transfers.repository';
import { AccessModule } from '../../access/access.module';
import { PlatformModule } from '../../platform/platform.module';
import { LinesModule } from '../lines.module';
import { TermsModule } from '../../pricing/terms.module';
import { WalletsModule } from '../../wallets/wallets.module';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';
import { Module } from '@nestjs/common';

/** Moving an account or a number to another parent. */
export const TRANSFERS_CONTROLLERS = [TransfersController];
export const TRANSFERS_PROVIDERS = [TransfersRepository, TransfersService];

@Module({
  imports: [PlatformModule, AccessModule, TermsModule, LinesModule, WalletsModule],
  controllers: TRANSFERS_CONTROLLERS,
  providers: TRANSFERS_PROVIDERS,
  exports: [],
})
export class TransfersModule {}
