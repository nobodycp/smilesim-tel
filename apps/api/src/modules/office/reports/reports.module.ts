import { ReportsRepository } from './reports.repository';
import { KernelModule } from '../kernel/kernel.module';
import { LinesModule } from '../lines/lines.module';
import { TasksModule } from '../tasks/tasks.module';
import { WalletsModule } from '../wallets/wallets.module';
import { InsightsService } from './insights.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { Module } from '@nestjs/common';

/** The branch's reports and their CSV exports. */
export const REPORTS_CONTROLLERS = [ReportsController];
export const REPORTS_PROVIDERS = [ReportsRepository, ReportsService, InsightsService];

@Module({
  imports: [KernelModule, TasksModule, LinesModule, WalletsModule],
  controllers: REPORTS_CONTROLLERS,
  providers: REPORTS_PROVIDERS,
  exports: [InsightsService],
})
export class ReportsModule {}
