import { DeskRepository } from './desk.repository';
import { AccessModule } from '../../access';
import { PlatformModule } from '../../platform';
import { ProvidersModule } from '../../providers';
import { ReportsModule } from '../reports/reports.module';
import { WalletsModule } from '../../wallets';
import { DeskController } from './desk.controller';
import { DeskService } from './desk.service';
import { LineSnapshotsService } from './line-snapshots.service';
import { OverviewService } from './overview.service';
import { Module } from '@nestjs/common';

/** The home page: who is signed in, the counters, the overview. */
export const DESK_CONTROLLERS = [DeskController];
export const DESK_PROVIDERS = [DeskRepository, DeskService, OverviewService, LineSnapshotsService];

@Module({
  imports: [PlatformModule, AccessModule, WalletsModule, ReportsModule, ProvidersModule],
  controllers: DESK_CONTROLLERS,
  providers: DESK_PROVIDERS,
  exports: [],
})
export class DeskModule {}
