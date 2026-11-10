import { queryString, request, segment } from '../../lib/http';
import type { AccountAccess, Page, UserRow } from '../../lib/api-types';

/** The accounts calls of the office API. Composed into `api` by lib/api.ts. */
export const accountsApi = {
  /** One page of the users table; the server filters, orders (layer, then login) and counts. */
  officeUsersPage: (query: { q?: string; layer?: string; cursor?: string | null }) =>
    request<Page<UserRow>>('GET', `/office/users${queryString(query)}`),
  officeAccount: (loginName: string) => request<AccountAccess>('GET', `/office/users/${segment(loginName)}`),
  saveAccountAccess: (loginName: string, body: { extraGrants: string[]; deniedGrants: string[]; extraRoleIds: string[]; roleId?: string }) =>
    request<{ ok: true }>('PATCH', `/office/users/${segment(loginName)}/access`, body),
  createUser: (body: { loginName: string; nickname: string; password: string; layer: string; parentLogin?: string; roleId?: string }) =>
    request<{ ok: true }>('POST', '/office/users', body),
  setUserPassword: (loginName: string, password: string) =>
    request<{ ok: true }>('POST', `/office/users/${segment(loginName)}/password`, { password }),
  freezeUser: (loginName: string) => request<{ ok: true }>('POST', `/office/users/${segment(loginName)}/freeze`),
  restoreUser: (loginName: string) => request<{ ok: true }>('POST', `/office/users/${segment(loginName)}/restore`),
  removeUser: (loginName: string) => request<{ ok: true }>('DELETE', `/office/users/${segment(loginName)}`),
  /** Answers the entered account's door and a one-time code that `handoff` trades there for the cookies. */
  enterUser: (loginName: string) => request<{ door: string; code: string }>('POST', `/office/users/${segment(loginName)}/enter`),
  handoff: (code: string) => request<{ ok: true }>('POST', '/office/handoff', { code }),
  leaveUser: () => request<{ ok: true }>('POST', '/office/leave'),
};
