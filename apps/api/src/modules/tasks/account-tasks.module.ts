import { Global, Module } from '@nestjs/common';
import { AccountTasks } from '../access/account-ports';
import { TasksModule } from './tasks.module';
import { TasksService } from './tasks.service';

/**
 * The tasks' side of access's `AccountTasks` port (slice R.8): `TasksService` under the port, one instance. Global,
 * like the notice writer, so the accounts get it without access importing tasks.
 */
export const ACCOUNT_TASKS_PROVIDERS = [{ provide: AccountTasks, useExisting: TasksService }];

@Global()
@Module({
  imports: [TasksModule],
  providers: ACCOUNT_TASKS_PROVIDERS,
  exports: [AccountTasks],
})
export class AccountTasksModule {}
