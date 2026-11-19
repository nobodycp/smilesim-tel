import { ROLES_CONTROLLERS, ROLES_PROVIDERS } from '../access/roles/roles.module';
import { COMPANIES_CONTROLLERS, COMPANIES_PROVIDERS } from '../catalog/companies/companies.module';
import { OFFERS_CONTROLLERS, OFFERS_PROVIDERS } from '../site/offers/offers.module';
import { AUDIT_CONTROLLERS, AUDIT_PROVIDERS } from '../auditing/audit.module';
import { NOTICES_CONTROLLERS, NOTICES_PROVIDERS } from '../notifications/notices.module';
import { CATALOG_CONTROLLERS, CATALOG_PROVIDERS } from '../catalog/shipped/catalog.module';
import { ACCOUNTS_CONTROLLERS, ACCOUNTS_PROVIDERS } from '../access/accounts/accounts.module';
import { TERMS_CONTROLLERS, TERMS_PROVIDERS } from '../pricing/terms.module';
import { PACKAGES_CONTROLLERS, PACKAGES_PROVIDERS } from '../catalog/packages/packages.module';
import { WALLETS_CONTROLLERS, WALLETS_PROVIDERS } from '../wallets/wallets.module';
import { TASKS_CONTROLLERS, TASKS_PROVIDERS } from '../tasks/tasks.module';
import { PROVIDERS_CONTROLLERS, PROVIDERS_PROVIDERS } from '../providers/providers.module';
import { PROVIDER_CATALOG_CONTROLLERS, PROVIDER_CATALOG_PROVIDERS } from '../catalog/provider-catalog/provider-catalog.module';
import { LINES_CONTROLLERS, LINES_PROVIDERS } from '../sales/lines.module';
import { TRANSFERS_CONTROLLERS, TRANSFERS_PROVIDERS } from '../sales/transfers/transfers.module';
import { REPORTS_CONTROLLERS, REPORTS_PROVIDERS } from '../reporting/reports/reports.module';
import { DESK_CONTROLLERS, DESK_PROVIDERS } from '../reporting/desk/desk.module';
import { ACCESS_MODULE_PROVIDERS } from '../access/access.module';
import { PLATFORM_MODULE_PROVIDERS } from '../platform/platform.module';
import { NOTICE_WRITER_PROVIDERS } from '../notifications/notice-writer.module';
import { ACCOUNT_TASKS_PROVIDERS } from '../tasks/account-tasks.module';
import { ACCOUNT_WALLETS_PROVIDERS } from '../wallets/account-wallets.module';
import { MONITORING_CONTROLLERS, MONITORING_PROVIDERS } from '../monitoring/monitoring.module';

// Every controller and provider of the domain modules as one flat list, for HTTP specs that build the API over their
// own in-memory tables in a single testing module. The app itself is wired by the modules (`modules/registry.ts`).
// Slice R.9: from `office.module.ts`, which is gone.
export const DOMAIN_CONTROLLERS = [...ROLES_CONTROLLERS, ...COMPANIES_CONTROLLERS, ...OFFERS_CONTROLLERS, ...AUDIT_CONTROLLERS, ...NOTICES_CONTROLLERS, ...CATALOG_CONTROLLERS, ...ACCOUNTS_CONTROLLERS, ...TERMS_CONTROLLERS, ...PACKAGES_CONTROLLERS, ...WALLETS_CONTROLLERS, ...TASKS_CONTROLLERS, ...PROVIDERS_CONTROLLERS, ...PROVIDER_CATALOG_CONTROLLERS, ...LINES_CONTROLLERS, ...TRANSFERS_CONTROLLERS, ...REPORTS_CONTROLLERS, ...DESK_CONTROLLERS, ...MONITORING_CONTROLLERS];
export const DOMAIN_PROVIDERS = [...NOTICE_WRITER_PROVIDERS, ...ACCOUNT_WALLETS_PROVIDERS, ...ACCOUNT_TASKS_PROVIDERS, ...PLATFORM_MODULE_PROVIDERS, ...ACCESS_MODULE_PROVIDERS, ...ROLES_PROVIDERS, ...COMPANIES_PROVIDERS, ...OFFERS_PROVIDERS, ...AUDIT_PROVIDERS, ...NOTICES_PROVIDERS, ...CATALOG_PROVIDERS, ...ACCOUNTS_PROVIDERS, ...TERMS_PROVIDERS, ...PACKAGES_PROVIDERS, ...WALLETS_PROVIDERS, ...TASKS_PROVIDERS, ...PROVIDERS_PROVIDERS, ...PROVIDER_CATALOG_PROVIDERS, ...LINES_PROVIDERS, ...TRANSFERS_PROVIDERS, ...REPORTS_PROVIDERS, ...DESK_PROVIDERS, ...MONITORING_PROVIDERS];
