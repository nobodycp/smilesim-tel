import { LinesRepository } from './lines.repository';
import { KernelModule } from '../kernel/kernel.module';
import { ProvidersModule } from '../providers/providers.module';
import { TasksModule } from '../tasks/tasks.module';
import { TermsModule } from '../terms/terms.module';
import { WalletsModule } from '../wallets/wallets.module';
import { LineAccess } from './line-access';
import { LinePricing } from './line-pricing';
import { LineReads } from './line-reads';
import { LinesController } from './lines.controller';
import { LinesService } from './lines.service';
import { ProviderDecisions } from './provider-decisions';
import { TaskCompletion } from './task-completion';
import { Module } from '@nestjs/common';

/** Numbers: reads, activation and every operation on a number, and closing the task that applies a deferred one. */
export const LINES_CONTROLLERS = [LinesController];
export const LINES_PROVIDERS = [LinesRepository, LinePricing, LineReads, LineAccess, TaskCompletion, ProviderDecisions, LinesService];

@Module({
  imports: [KernelModule, TasksModule, WalletsModule, TermsModule, ProvidersModule],
  controllers: LINES_CONTROLLERS,
  providers: LINES_PROVIDERS,
  exports: [LineReads, LineAccess],
})
export class LinesModule {}
