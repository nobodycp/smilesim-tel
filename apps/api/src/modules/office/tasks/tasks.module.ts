import { TasksRepository } from './tasks.repository';
import { KernelModule } from '../kernel/kernel.module';
import { WalletsModule } from '../wallets/wallets.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { Module } from '@nestjs/common';

/** Branch tasks: opening, notes, taking, rejecting, cancelling. */
export const TASKS_CONTROLLERS = [TasksController];
export const TASKS_PROVIDERS = [TasksRepository, TasksService];

@Module({
  imports: [KernelModule, WalletsModule],
  controllers: TASKS_CONTROLLERS,
  providers: TASKS_PROVIDERS,
  exports: [TasksService],
})
export class TasksModule {}
