import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OfficeController } from './office.controller';
import { OfficeService } from './office.service';
import { PackagesController } from './packages/packages.controller';
import { PackagesService } from './packages/packages.service';
import { CompaniesController } from './companies/companies.controller';
import { CompaniesService } from './companies/companies.service';
import { ProvidersController } from './providers/providers.controller';
import { ProvidersService } from './providers/providers.service';
import { WalletsController } from './wallets/wallets.controller';
import { WalletsService } from './wallets/wallets.service';
import { NoticeService } from './notice.service';
import { OfficeKernel } from './kernel/office-kernel';
import { NoticeInboxService } from './notices/notice-inbox.service';
import { NoticesController } from './notices/notices.controller';
import { AuditController } from './audit/audit.controller';
import { AuditService } from './audit/audit.service';
import { TasksController } from './tasks/tasks.controller';
import { TasksService } from './tasks/tasks.service';

// Exported so HTTP specs build the same set of office routes the app serves, whichever controller holds them.
export const OFFICE_CONTROLLERS = [OfficeController, NoticesController, AuditController, TasksController, WalletsController, ProvidersController, CompaniesController, PackagesController];
export const OFFICE_PROVIDERS = [NoticeService, OfficeKernel, OfficeService, NoticeInboxService, AuditService, TasksService, WalletsService, ProvidersService, CompaniesService, PackagesService];

@Module({
  imports: [AuthModule],
  controllers: OFFICE_CONTROLLERS,
  providers: OFFICE_PROVIDERS,
})
export class OfficeModule {}
