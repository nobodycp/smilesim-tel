import { DeskRepository } from './desk.repository';
import { KernelModule } from '../kernel/kernel.module';
import { ProvidersModule } from '../providers/providers.module';
import { ReportsModule } from '../reports/reports.module';
import { WalletsModule } from '../wallets/wallets.module';
import { DeskController } from './desk.controller';
import { DeskService } from './desk.service';
import { LineSnapshotsService } from './line-snapshots.service';
import { OverviewService } from './overview.service';
import { Module } from '@nestjs/common';

/** The home page: who is signed in, the counters, the overview. */
export const DESK_CONTROLLERS = [DeskController];
export const DESK_PROVIDERS = [DeskRepository, DeskService, OverviewService, LineSnapshotsService];

@Module({
  imports: [KernelModule, WalletsModule, ReportsModule, ProvidersModule],
  controllers: DESK_CONTROLLERS,
  providers: DESK_PROVIDERS,
  exports: [],
})
export class DeskModule {}
