// The office API, one object for the pages: each domain's calls live in features/<domain>/api.ts, the request
// machinery in lib/http.ts, the shapes in lib/api-types.ts.

import { authApi } from '../features/auth/api';
import { brandingApi } from '../features/branding/api';
import { deskApi } from '../features/desk/api';
import { walletsApi } from '../features/wallets/api';
import { catalogApi } from '../features/catalog/api';
import { termsApi } from '../features/terms/api';
import { linesApi } from '../features/lines/api';
import { transfersApi } from '../features/transfers/api';
import { noticesApi } from '../features/notices/api';
import { tasksApi } from '../features/tasks/api';
import { accountsApi } from '../features/accounts/api';
import { rolesApi } from '../features/roles/api';
import { auditApi } from '../features/audit/api';
import { reportsApi } from '../features/reports/api';
import { providerAccountsApi } from '../features/providers/api';

export * from './api-types';

export const api = {
  ...authApi,
  ...brandingApi,
  ...deskApi,
  ...walletsApi,
  ...catalogApi,
  ...termsApi,
  ...linesApi,
  ...transfersApi,
  ...noticesApi,
  ...tasksApi,
  ...accountsApi,
  ...rolesApi,
  ...auditApi,
  ...reportsApi,
  ...providerAccountsApi,
};
