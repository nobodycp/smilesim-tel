import { LinesRepository } from './lines.repository';
import { AccessModule } from '../access';
import { PlatformModule } from '../platform';
import { ProvidersModule } from '../providers';
import { TasksModule } from '../tasks';
import { TermsModule } from '../pricing';
import { WalletsModule } from '../wallets';
import { LineAccess } from './line-access';
import { LinePricing } from './line-pricing';
import { LineReads } from './line-reads';
import { LinesController } from './lines.controller';
import { LinesService } from './lines.service';
import { ProviderDecisions } from './settlement/provider-decisions';
import { TaskCompletion } from './settlement/task-completion';
import { Module } from '@nestjs/common';

/** Numbers: reads, activation and every operation on a number, and closing the task that applies a deferred one. */
export const LINES_CONTROLLERS = [LinesController];
export const LINES_PROVIDERS = [LinesRepository, LinePricing, LineReads, LineAccess, TaskCompletion, ProviderDecisions, LinesService];

@Module({
  imports: [PlatformModule, AccessModule, TasksModule, WalletsModule, TermsModule, ProvidersModule],
  controllers: LINES_CONTROLLERS,
  providers: LINES_PROVIDERS,
  exports: [LineReads, LineAccess],
})
export class LinesModule {}
