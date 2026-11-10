import { request, segment } from '../../lib/http';
import type { RoleRow } from '../../lib/api-types';

/** The roles calls of the office API. Composed into `api` by lib/api.ts. */
export const rolesApi = {
  officeRoles: () => request<{ roles: RoleRow[]; capped?: boolean }>('GET', '/office/roles'),
  /** A new job role without an `id`; with one, a change to that role. */
  saveRole: ({ id, ...body }: { id?: string; name: string; grants: string[]; read: boolean; edit: boolean; accounting: boolean; tasks: boolean; reports: boolean; staff: boolean; enter: boolean }) =>
    id ? request<{ ok: true }>('PUT', `/office/roles/${segment(id)}`, body) : request<{ ok: true }>('POST', '/office/roles', body),
};
