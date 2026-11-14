// apps/api/src/modules/registry.ts
import { AuthModule } from './auth/auth.module';
import { BrandingModule } from './branding/branding.module';
import { ActivityModule } from './auditing/activity.module';
import { NoticeWriterModule } from './notifications/notice-writer.module';
import { RolesModule } from './access/roles/roles.module';
import { CompaniesModule } from './catalog/companies/companies.module';
import { OffersModule } from './catalog/offers/offers.module';
import { AuditModule } from './auditing/audit.module';
import { NoticesModule } from './notifications/notices.module';
import { CatalogModule } from './catalog/shipped/catalog.module';
import { AccountsModule } from './access/accounts/accounts.module';
import { TermsModule } from './pricing/terms.module';
import { PackagesModule } from './catalog/packages/packages.module';
import { WalletsModule } from './wallets/wallets.module';
import { TasksModule } from './tasks/tasks.module';
import { ProvidersModule } from './providers/providers.module';
import { LinesModule } from './sales/lines.module';
import { TransfersModule } from './sales/transfers/transfers.module';
import { ReportsModule } from './reporting/reports/reports.module';
import { DeskModule } from './reporting/desk/desk.module';
import { DuplicateGuardModule } from './platform/duplicate-guard.module';
import { AccountTasksModule } from './tasks/account-tasks.module';
import { AccountWalletsModule } from './wallets/account-wallets.module';
import { PrismaModule } from './platform/prisma.service';

// Slice R.9: no umbrella. The duplicate-write guard is the platform's module; then one module per domain, in the
// order the umbrella imported them.
// The two global writers first: the activity log and the notice writer, each the one implementation of a port of
// the platform (ADR 0020, slice R.2).
// Then the bindings of access's two ports (slice R.8), global like the writers.
// The extension contract requires `any[]` here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const featureModules: any[] = [PrismaModule, ActivityModule, NoticeWriterModule, AuthModule, DuplicateGuardModule, RolesModule, CompaniesModule, OffersModule, AuditModule, NoticesModule, CatalogModule, AccountsModule, TermsModule, PackagesModule, WalletsModule, TasksModule, ProvidersModule, LinesModule, TransfersModule, ReportsModule, DeskModule, AccountWalletsModule, AccountTasksModule, BrandingModule];
