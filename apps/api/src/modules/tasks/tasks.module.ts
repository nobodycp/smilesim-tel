import { TasksRepository } from './tasks.repository';
import { AccessModule } from '../access';
import { PlatformModule } from '../platform';
import { WalletsModule } from '../wallets';
import { ProvidersModule } from '../providers';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { Module } from '@nestjs/common';

/** Branch tasks: opening, notes, taking, rejecting, cancelling. */
export const TASKS_CONTROLLERS = [TasksController];
export const TASKS_PROVIDERS = [TasksRepository, TasksService];

@Module({
  imports: [PlatformModule, AccessModule, WalletsModule, ProvidersModule],
  controllers: TASKS_CONTROLLERS,
  providers: TASKS_PROVIDERS,
  exports: [TasksService],
})
export class TasksModule {}
