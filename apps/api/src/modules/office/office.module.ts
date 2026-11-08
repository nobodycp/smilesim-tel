import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DuplicateGuardInterceptor } from '../shared/duplicate-guard.interceptor';
import { AuthModule } from '../auth/auth.module';
import { CatalogSeed } from './catalog/catalog-seed';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';
import { LinesController } from './lines/lines.controller';
import { LinesService } from './lines/lines.service';
import { TransfersController } from './transfers/transfers.controller';
import { TransfersService } from './transfers/transfers.service';
import { AccountsController } from './accounts/accounts.controller';
import { AccountSessionController } from './accounts/account-session.controller';
import { AccountSessionService } from './accounts/account-session.service';
import { AccountsService } from './accounts/accounts.service';
import { DeskController } from './desk/desk.controller';
import { DeskService } from './desk/desk.service';
import { RolesController } from './roles/roles.controller';
import { RolesService } from './roles/roles.service';
import { TermsController } from './terms/terms.controller';
import { TermsService } from './terms/terms.service';
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
export const OFFICE_CONTROLLERS = [NoticesController, AuditController, TasksController, WalletsController, ProvidersController, CompaniesController, PackagesController, TermsController, RolesController, DeskController, AccountsController, AccountSessionController, TransfersController, LinesController, ReportsController];
export const OFFICE_PROVIDERS = [NoticeService, OfficeKernel, NoticeInboxService, AuditService, TasksService, WalletsService, ProvidersService, CompaniesService, PackagesService, TermsService, RolesService, DeskService, AccountsService, AccountSessionService, TransfersService, LinesService, ReportsService, CatalogSeed];

@Module({
  imports: [AuthModule],
  controllers: OFFICE_CONTROLLERS,
  // Not in OFFICE_PROVIDERS: HTTP specs repeat writes on purpose; duplicate-guard.interceptor.spec.ts covers it.
  providers: [...OFFICE_PROVIDERS, { provide: APP_INTERCEPTOR, useClass: DuplicateGuardInterceptor }],
})
export class OfficeModule {}
