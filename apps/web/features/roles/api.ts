import { request } from '../../lib/http';
import type { RoleRow } from '../../lib/api-types';

/** The roles calls of the office API. Composed into `api` by lib/api.ts. */
export const rolesApi = {
  officeRoles: () => request<{ roles: RoleRow[] }>('GET', '/office/roles'),
  saveRole: (body: { id?: string; name: string; grants: string[]; read: boolean; edit: boolean; accounting: boolean; tasks: boolean; reports: boolean; staff: boolean; enter: boolean }) =>
    request<{ ok: true }>('POST', '/office/roles', body),
};
