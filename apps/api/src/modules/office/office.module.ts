import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DuplicateGuardInterceptor } from '../shared/duplicate-guard.interceptor';
import { ROLES_CONTROLLERS, ROLES_PROVIDERS, RolesModule } from './roles/roles.module';
import { COMPANIES_CONTROLLERS, COMPANIES_PROVIDERS, CompaniesModule } from './companies/companies.module';
import { OFFERS_CONTROLLERS, OFFERS_PROVIDERS, OffersModule } from './offers/offers.module';
import { AUDIT_CONTROLLERS, AUDIT_PROVIDERS, AuditModule } from './audit/audit.module';
import { NOTICES_CONTROLLERS, NOTICES_PROVIDERS, NoticesModule } from './notices/notices.module';
import { CATALOG_CONTROLLERS, CATALOG_PROVIDERS, CatalogModule } from './catalog/catalog.module';
import { ACCOUNTS_CONTROLLERS, ACCOUNTS_PROVIDERS, AccountsModule } from './accounts/accounts.module';
import { TERMS_CONTROLLERS, TERMS_PROVIDERS, TermsModule } from './terms/terms.module';
import { PACKAGES_CONTROLLERS, PACKAGES_PROVIDERS, PackagesModule } from './packages/packages.module';
import { WALLETS_CONTROLLERS, WALLETS_PROVIDERS, WalletsModule } from './wallets/wallets.module';
import { TASKS_CONTROLLERS, TASKS_PROVIDERS, TasksModule } from './tasks/tasks.module';
import { PROVIDERS_CONTROLLERS, PROVIDERS_PROVIDERS, ProvidersModule } from './providers/providers.module';
import { LINES_CONTROLLERS, LINES_PROVIDERS, LinesModule } from './lines/lines.module';
import { TRANSFERS_CONTROLLERS, TRANSFERS_PROVIDERS, TransfersModule } from './transfers/transfers.module';
import { REPORTS_CONTROLLERS, REPORTS_PROVIDERS, ReportsModule } from './reports/reports.module';
import { DESK_CONTROLLERS, DESK_PROVIDERS, DeskModule } from './desk/desk.module';
import { KERNEL_MODULE_PROVIDERS } from './kernel/kernel.module';

const DOMAIN_MODULES = [RolesModule, CompaniesModule, OffersModule, AuditModule, NoticesModule, CatalogModule, AccountsModule, TermsModule, PackagesModule, WalletsModule, TasksModule, ProvidersModule, LinesModule, TransfersModule, ReportsModule, DeskModule];

// The same controllers and providers as one flat list, for HTTP specs that build the office over their own
// in-memory tables in a single testing module. The app itself is wired by the domain modules above.
export const OFFICE_CONTROLLERS = [...ROLES_CONTROLLERS, ...COMPANIES_CONTROLLERS, ...OFFERS_CONTROLLERS, ...AUDIT_CONTROLLERS, ...NOTICES_CONTROLLERS, ...CATALOG_CONTROLLERS, ...ACCOUNTS_CONTROLLERS, ...TERMS_CONTROLLERS, ...PACKAGES_CONTROLLERS, ...WALLETS_CONTROLLERS, ...TASKS_CONTROLLERS, ...PROVIDERS_CONTROLLERS, ...LINES_CONTROLLERS, ...TRANSFERS_CONTROLLERS, ...REPORTS_CONTROLLERS, ...DESK_CONTROLLERS];
export const OFFICE_PROVIDERS = [...KERNEL_MODULE_PROVIDERS, ...ROLES_PROVIDERS, ...COMPANIES_PROVIDERS, ...OFFERS_PROVIDERS, ...AUDIT_PROVIDERS, ...NOTICES_PROVIDERS, ...CATALOG_PROVIDERS, ...ACCOUNTS_PROVIDERS, ...TERMS_PROVIDERS, ...PACKAGES_PROVIDERS, ...WALLETS_PROVIDERS, ...TASKS_PROVIDERS, ...PROVIDERS_PROVIDERS, ...LINES_PROVIDERS, ...TRANSFERS_PROVIDERS, ...REPORTS_PROVIDERS, ...DESK_PROVIDERS];

/** The office: one module per domain. The duplicate-write guard is registered here, once, for every route. */
@Module({
  imports: DOMAIN_MODULES,
  providers: [{ provide: APP_INTERCEPTOR, useClass: DuplicateGuardInterceptor }],
})
export class OfficeModule {}
