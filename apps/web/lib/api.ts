// Every call goes to the backend with the session cookie. No login policy lives here:
// the backend decides, and the pages display what it returns.

type Next = 'password' | 'two_factor_enroll' | 'two_factor_code' | 'app';

// A failure carries the Arabic `message` the API sent and, from an API that has the error contract,
// the stable `code` (see apps/api/src/errors.ts). Decisions and translations go by `code`.
type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; message: string; code?: string };

export type Profile = { nickname?: string; email?: string; phone?: string };
type AccountProfile = Profile & { loginName: string };

export type SessionInfo = {
  id: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
};

import { doorFromHost } from './doors';

const base = () => (typeof window === 'undefined' ? process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001' : '/api');

const NETWORK_MESSAGE = 'تعذّر الاتصال بالخادم';
const GENERIC_MESSAGE = 'حدث خطأ';

// The session is gone, or belongs to another door: back to /login. The code decides. The Arabic
// sentence is kept as a fallback for an API that does not send a code yet.
function endsSession(status: number, code: string | undefined, message: string): boolean {
  if (code) return code === 'LOGIN_REQUIRED' || code === 'DOOR_MISMATCH';
  return (status === 401 && message === 'يلزم تسجيل الدخول') || (status === 403 && message === 'هذا الحساب ليس لهذا المدخل');
}

async function request<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  let response: Response;
  const door = typeof window === 'undefined' ? null : doorFromHost(window.location.host);
  const headers: Record<string, string> = {};
  if (door) headers['x-door'] = door.host;
  if (body !== undefined) headers['content-type'] = 'application/json';
  try {
    response = await fetch(`${base()}${path}`, {
      method,
      credentials: 'include',
      headers: Object.keys(headers).length ? headers : undefined,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, message: NETWORK_MESSAGE, code: 'NETWORK' };
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const hasMessage = typeof data?.message === 'string';
    const message = hasMessage ? data.message : GENERIC_MESSAGE;
    const code = typeof data?.code === 'string' ? data.code : hasMessage ? undefined : 'GENERIC';
    if (typeof window !== 'undefined' && window.location.pathname !== '/login' && endsSession(response.status, code, message)) {
      window.location.assign('/login');
    }
    return { ok: false, status: response.status, message, ...(code ? { code } : {}) };
  }
  return { ok: true, status: response.status, data: data as T };
}

const segment = encodeURIComponent;

// Empty values are left out, so a cleared filter sends nothing.
function queryString(query?: Record<string, string | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value) params.set(key, value);
  }
  const tail = params.toString();
  return tail ? `?${tail}` : '';
}

export const api = {
  login: (loginName: string, password: string) =>
    request<{ next: Next }>('POST', '/auth/login', { loginName, password }),
  changePassword: (password: string, nextPassword: string) =>
    request<{ next: Next }>('POST', '/auth/password', { password, nextPassword }),
  getProfile: () => request<AccountProfile>('GET', '/auth/profile'),
  updateProfile: (patch: {
    nickname?: string;
    email?: string;
    phone?: string;
    nextPassword?: string;
    currentPassword?: string;
  }) => request<Profile>('PATCH', '/auth/profile', patch),
  listSessions: () => request<{ sessions: SessionInfo[] }>('GET', '/auth/sessions'),
  revokeSession: (id: string) => request<{ ok: true }>('DELETE', `/auth/sessions/${segment(id)}`),
  setupTwoFactor: () => request<{ otpauth: string }>('POST', '/auth/two-factor/setup'),
  confirmTwoFactor: (code: string) => request<{ next: Next }>('POST', '/auth/two-factor/confirm', { code }),
  verifyTwoFactor: (code: string) => request<{ next: Next }>('POST', '/auth/two-factor/verify', { code }),
  officeMe: () => request<OfficeMe>('GET', '/office/me'),
  officeHome: () => request<HomePayload>('GET', '/office/home'),
  postAnnouncement: (body: string) => request<{ ok: true }>('POST', '/office/announcements', { body }),
  fundWallet: (loginName: string, amount: number, note: string) =>
    request<{ ok: true }>('POST', `/office/wallets/${segment(loginName)}/fund`, { amount, note }),
  setCeiling: (loginName: string, ceiling: number) =>
    request<{ ok: true }>('PATCH', `/office/wallets/${segment(loginName)}/ceiling`, { ceiling }),
  officePackages: () => request<{ packages: PackageRow[]; companies: { name: string; image: string }[] }>('GET', '/office/packages'),
  officeCompanies: () => request<Shelf>('GET', '/office/companies'),
  setCompanyImage: (name: string, image: string) => request<{ ok: true }>('POST', '/office/companies/image', { name, image }),
  setPackagePrice: (code: string, price: number) =>
    request<{ ok: true }>('PATCH', `/office/packages/${segment(code)}/price`, { price }),
  officeProviders: () => request<{ providers: ProviderRow[] }>('GET', '/office/providers'),
  officeLines: (query?: { q?: string; status?: string; packageCode?: string; cursor?: string | null }) =>
    request<{ lines: LineRow[]; poses: PosChoice[]; nextCursor: string | null }>('GET', `/office/lines${queryString(query)}`),
  officeLine: (id: string) => request<{ line: LineRow; history: LineHistory[] }>('GET', `/office/lines/${segment(id)}`),
  activateLine: (body: ActivateBody) => request<ApplyResult>('POST', '/office/lines', body),
  officeAudit: (query?: { kind?: string; cursor?: string | null }) =>
    request<{ entries: AuditRow[]; nextCursor: string | null }>('GET', `/office/audit${queryString(query)}`),
  officeAccounting: (query?: { q?: string; cursor?: string | null }) =>
    request<{ entries: AccountingRow[]; nextCursor: string | null }>('GET', `/office/accounting${queryString(query)}`),
  officeLedger: (scope: string, query: { kind?: string; direction?: string; from?: string; to?: string; cursor?: string | null }) =>
    request<{ entries: LedgerRow[]; nextCursor: string | null }>('GET', `/office/ledger/${segment(scope)}${queryString(query)}`),
  extendLine: (id: string, outcome: Outcome) => request<ApplyResult>('POST', `/office/lines/${segment(id)}/extend`, { outcome }),
  reactivateLine: (id: string, outcome: Outcome) => request<ApplyResult>('POST', `/office/lines/${segment(id)}/reactivate`, { outcome }),
  renameLine: (id: string, msisdn: string, outcome: Outcome) =>
    request<ApplyResult>('POST', `/office/lines/${segment(id)}/rename`, { msisdn, outcome }),
  swapSim: (id: string, iccid: string, outcome: Outcome) =>
    request<ApplyResult>('POST', `/office/lines/${segment(id)}/sim`, { iccid, outcome }),
  disconnectLine: (id: string, outcome: Outcome) =>
    request<ApplyResult>('POST', `/office/lines/${segment(id)}/disconnect`, { outcome }),
  freezeLine: (id: string, outcome: Outcome) => request<ApplyResult>('POST', `/office/lines/${segment(id)}/freeze`, { outcome }),
  unfreezeLine: (id: string, outcome: Outcome) => request<ApplyResult>('POST', `/office/lines/${segment(id)}/unfreeze`, { outcome }),
  switchLine: (id: string, packageCode: string, outcome: Outcome) =>
    request<ApplyResult>('POST', `/office/lines/${segment(id)}/switch`, { packageCode, outcome }),
  officeNotices: () => request<{ unread: number; notices: NoticeRow[] }>('GET', '/office/notices'),
  readNotices: (id?: string) => request<{ ok: true }>('POST', '/office/notices/read', id ? { id } : {}),
  officeTasks: (query?: { status?: string; cursor?: string | null }) =>
    request<{ tasks: TaskRow[]; nextCursor: string | null }>('GET', `/office/tasks${queryString(query)}`),
  takeTask: (id: string) => request<{ ok: true }>('POST', `/office/tasks/${segment(id)}/take`),
  releaseTask: (id: string) => request<{ ok: true }>('POST', `/office/tasks/${segment(id)}/release`),
  completeTask: (id: string, note: string) => request<{ ok: true }>('POST', `/office/tasks/${segment(id)}/complete`, { note }),
  rejectTask: (id: string, reason: string) => request<{ ok: true }>('POST', `/office/tasks/${segment(id)}/reject`, { reason }),
  cancelTask: (id: string) => request<{ ok: true }>('POST', `/office/tasks/${segment(id)}/cancel`),
  officeUsers: () => request<{ users: UserRow[] }>('GET', '/office/users'),
  createUser: (body: { loginName: string; nickname: string; password: string; layer: string; parentLogin?: string; roleId?: string }) =>
    request<{ ok: true }>('POST', '/office/users', body),
  officeRoles: () => request<{ roles: { id: string; name: string; read: boolean; edit: boolean; accounting: boolean; tasks: boolean; reports: boolean; staff: boolean; enter: boolean }[] }>('GET', '/office/roles'),
  saveRole: (body: { id?: string; name: string; read: boolean; edit: boolean; accounting: boolean; tasks: boolean; reports: boolean; staff: boolean; enter: boolean }) =>
    request<{ ok: true }>('POST', '/office/roles', body),
  transferPos: (loginName: string, parentLogin: string) =>
    request<{ ok: true }>('POST', `/office/users/${segment(loginName)}/transfer`, { parentLogin }),
  transferLine: (id: string, posLogin: string) => request<{ ok: true }>('POST', `/office/lines/${segment(id)}/transfer`, { posLogin }),
  setPackageMode: (code: string, body: Record<string, boolean | string>) =>
    request<{ ok: true }>('PATCH', `/office/packages/${segment(code)}/mode`, body),
  packageSheet: (code: string) => request<PackageSheet>('GET', `/office/packages/${segment(code)}/sheet`),
  setChain: (code: string, body: Partial<{
    branchCost: number;
    mainPrice: number;
    agentPrice: number;
    posPrice: number;
    subscriberPrice: number;
    renewalBranchCost: number;
    renewalMainPrice: number;
    renewalAgentPrice: number;
    renewalPosPrice: number;
    renewalSubscriberPrice: number;
  }>) =>
    request<{ ok: true }>('PATCH', `/office/packages/${segment(code)}/chain`, body),
  setPackageRenewals: (code: string, targets: string[]) =>
    request<{ ok: true }>('PUT', `/office/packages/${segment(code)}/renewals`, { targets }),
  setPackageSwitches: (code: string, targets: string[]) =>
    request<{ ok: true }>('PUT', `/office/packages/${segment(code)}/switches`, { targets }),
  saveOffer: (code: string, loginName: string, price: number) =>
    request<{ ok: true }>('PUT', `/office/packages/${segment(code)}/offers`, { loginName, price }),
  removeOffer: (code: string, loginName: string) =>
    request<{ ok: true }>('DELETE', `/office/packages/${segment(code)}/offers/${segment(loginName)}`),
  setUserPassword: (loginName: string, password: string) =>
    request<{ ok: true }>('POST', `/office/users/${segment(loginName)}/password`, { password }),
  freezeUser: (loginName: string) => request<{ ok: true }>('POST', `/office/users/${segment(loginName)}/freeze`),
  restoreUser: (loginName: string) => request<{ ok: true }>('POST', `/office/users/${segment(loginName)}/restore`),
  removeUser: (loginName: string) => request<{ ok: true }>('DELETE', `/office/users/${segment(loginName)}`),
  enterUser: (loginName: string) => request<{ sessionId: string }>('POST', `/office/users/${segment(loginName)}/enter`),
  leaveUser: () => request<{ ok: true }>('POST', '/office/leave'),
  officeReport: (kind: string, cursor?: string | null) =>
    request<ReportPayload>('GET', `/office/reports/${segment(kind)}${queryString({ cursor })}`),
};

export type Outcome = 'success' | 'fail';
export type OfficeMe = {
  loginName: string;
  nickname: string;
  layer: string;
  isBranchOwner: boolean;
  grants: string[];
  impersonating: boolean;
  balance: number;
  ceiling: number;
};
export type HomePayload = {
  pendingTasks: number;
  activeLines: number;
  inactiveLines: number;
  canPost: boolean;
  operations: { id: string; at: string; kind: string; amount: number; note: string | null; loginName: string }[];
  announcements: { id: string; body: string; at: string; authorName: string; authorLayer: string }[];
};
export type PackageRow = {
  code: string;
  name: string;
  providerName: string;
  companyName: string;
  dataGb: number | null;
  months: number;
  branchCost: number;
  mainPrice: number;
  agentPrice: number;
  posPrice: number;
  subscriberPrice: number;
  editableField: 'main' | 'agent' | 'pos' | null;
  autoActivate: boolean;
  autoCharge: boolean;
  autoDisconnect: boolean;
  autoFreeze: boolean;
  autoSwitch: boolean;
};
export type ProviderRow = {
  code: string;
  name: string;
  companies: {
    name: string;
    image: string;
    packages: { code: string; name: string; dataGb: number | null; months: number; price: number; enabled: boolean }[];
  }[];
};
export type Shelf = {
  companies: {
    code: string;
    name: string;
    providers: {
      code: string;
      name: string;
      packages: {
        code: string;
        name: string;
        months: number;
        forSale: boolean;
        lines: number;
        activeLines: number;
      }[];
    }[];
  }[];
};
export type PackageSheet = {
  code: string;
  name: string;
  providerCode: string;
  providerName: string;
  companyCode: string;
  companyName: string;
  enabled: boolean;
  forSale: boolean;
  branchCost: number;
  mainPrice: number;
  agentPrice: number;
  posPrice: number;
  subscriberPrice: number;
  renewalBranchCost: number;
  renewalMainPrice: number;
  renewalAgentPrice: number;
  renewalPosPrice: number;
  renewalSubscriberPrice: number;
  lines: number;
  activeLines: number;
  renewals: string[];
  switches: string[];
  modes: Record<string, 'auto' | 'manual' | 'off'>;
  offers: { loginName: string; nickname: string; layer: string; price: number }[];
};
export type UserRow = {
  loginName: string;
  nickname: string;
  layer: string;
  roleName: string;
  parentLogin: string | null;
  balance: number;
  ceiling: number;
  frozen: boolean;
  self: boolean;
  directChild: boolean;
  canEnter: boolean;
  canFreeze: boolean;
  canDelete: boolean;
};
export type ReportPayload = {
  rows?: { providerName: string; companyName: string; packageName: string; price: number; lines: number }[];
  entries?: ReportRow[];
  lines?: LineRow[];
  tasks?: TaskRow[];
  nextCursor?: string | null;
};
export type LineRow = {
  id: string;
  msisdn: string;
  iccid: string | null;
  esim: boolean;
  status: string;
  packageCode: string;
  packageName: string;
  companyName: string;
  posLogin: string;
  posPrice: number;
  createdAt: string;
  endsAt: string;
  opsLocked?: boolean;
};
export type LineHistory = {
  id: string;
  action: string;
  at: string;
  msisdn: string | null;
  companyName: string;
  packageName: string;
  actorName: string;
};
export type PosChoice = { loginName: string; nickname: string };
type ActivateBody = { packageCode: string; posLogin: string; esim: boolean; iccid: string; msisdn: string; outcome: Outcome };
export type LedgerRow = {
  id: string;
  at: string;
  kind: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  note: string | null;
  packageName: string | null;
  msisdn: string | null;
  actorLogin: string;
};
export type AuditRow = {
  id: string;
  action: string;
  status: string;
  at: string;
  msisdn: string;
  companyName: string;
  packageName: string;
  providerName: string;
  actorName: string;
};
export type AccountingRow = {
  id: string;
  at: string;
  msisdn: string;
  companyName: string;
  packageName: string;
  packagePrice: number;
  balanceBefore: number;
  balanceAfter: number;
};
export type ApplyResult = { applied: boolean; taskId?: string };
export type NoticeRow = {
  id: string;
  kind: string;
  action: string;
  msisdn: string | null;
  href: string;
  read: boolean;
  createdAt: string;
};
export type TaskRow = {
  id: string;
  action: string;
  status: string;
  posLogin: string;
  submitterLogin: string;
  assigneeLogin: string | null;
  posDelta: number;
  msisdn: string | null;
  packageName: string;
  note: string | null;
  resultNote: string | null;
  log?: string;
  canTake: boolean;
  canWork: boolean;
  canCancel: boolean;
};
type ReportRow = {
  id: string;
  at: string;
  loginName: string;
  actorLogin: string;
  amount: number;
  balanceAfter: number;
  kind: string;
  note: string | null;
};

export const TWO_FACTOR_STEP_KEY = 'twoFactorStep';

// Route on the `next` field only. Both authenticator steps go to `/two-factor` with no
// query string; which step it is travels in sessionStorage.
export function routeFor(next: Next): string {
  switch (next) {
    case 'password':
      return '/password';
    case 'two_factor_enroll':
      sessionStorage.setItem(TWO_FACTOR_STEP_KEY, 'enroll');
      return '/two-factor';
    case 'two_factor_code':
      sessionStorage.setItem(TWO_FACTOR_STEP_KEY, 'code');
      return '/two-factor';
    case 'app':
      return '/';
  }
}
