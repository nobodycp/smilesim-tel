// apps/api/src/modules/registry.spec.ts
import { AuthModule } from './auth/auth.module';
import { BrandingModule } from './site/branding/branding.module';
import { ActivityModule } from './auditing/activity.module';
import { NoticeWriterModule } from './notifications/notice-writer.module';
import { RolesModule } from './access/roles/roles.module';
import { CompaniesModule } from './postpaid/catalog/companies/companies.module';
import { OffersModule } from './site/offers/offers.module';
import { PicturesModule } from './postpaid/catalog/pictures/pictures.module';
import { OfferPicturesModule } from './site/pictures/offer-pictures.module';
import { AuditModule } from './auditing/audit.module';
import { NoticesModule } from './notifications/notices.module';
import { CatalogModule } from './postpaid/catalog/shipped/catalog.module';
import { AccountsModule } from './access/accounts/accounts.module';
import { TermsModule } from './postpaid/pricing/terms.module';
import { PackagesModule } from './postpaid/catalog/packages/packages.module';
import { WalletsModule } from './wallets/wallets.module';
import { TasksModule } from './tasks/tasks.module';
import { ProvidersModule } from './providers/providers.module';
import { ProviderCatalogModule } from './postpaid/catalog/provider-catalog/provider-catalog.module';
import { LinesModule } from './postpaid/sales/lines.module';
import { TransfersModule } from './postpaid/sales/transfers/transfers.module';
import { ReportsModule } from './reporting/reports/reports.module';
import { DeskModule } from './reporting/desk/desk.module';
import { DuplicateGuardModule } from './platform/duplicate-guard.module';
import { AccountTasksModule } from './tasks/account-tasks.module';
import { AccountWalletsModule } from './wallets/account-wallets.module';
import { featureModules } from './registry';
import { PrismaModule } from './platform/prisma.service';
import { MonitoringModule } from './monitoring/monitoring.module';

describe('featureModules', () => {
  it('registers every feature module: no umbrella (slice R.9), the duplicate guard as the platform\'s module, one module per domain', () => {
    expect(featureModules).toEqual([PrismaModule, ActivityModule, NoticeWriterModule, AuthModule, DuplicateGuardModule, RolesModule, CompaniesModule, OffersModule, AuditModule, NoticesModule, CatalogModule, AccountsModule, TermsModule, PackagesModule, WalletsModule, TasksModule, ProvidersModule, ProviderCatalogModule, LinesModule, TransfersModule, ReportsModule, DeskModule, AccountWalletsModule, AccountTasksModule, BrandingModule, PicturesModule, OfferPicturesModule, MonitoringModule]);
  });
});
