import { request, segment } from '../../lib/http';
import type { AccountAccess, UserRow } from '../../lib/api-types';

/** The accounts calls of the office API. Composed into `api` by lib/api.ts. */
export const accountsApi = {
  officeUsers: () => request<{ users: UserRow[] }>('GET', '/office/users'),
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
  enterUser: (loginName: string) => request<{ sessionId: string }>('POST', `/office/users/${segment(loginName)}/enter`),
  leaveUser: () => request<{ ok: true }>('POST', '/office/leave'),
};
