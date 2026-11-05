// Every call goes to the backend with the session cookie. No login policy lives here:
// the backend decides, and the pages display what it returns.

type Next = 'password' | 'two_factor_enroll' | 'two_factor_code' | 'app';

// A failure carries the Arabic `message` the API sent and, from an API that has the error contract,
// the stable `code` (see apps/api/src/errors.ts). Decisions and translations go by `code`.
type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; message: string; code?: string };

/** `nickname` carries the full name; the field keeps its historical name. `city` is a key from lib/cities.ts. */
export type Profile = { nickname?: string; email?: string; phone?: string; city?: string; address?: string };
type AccountProfile = Profile & { loginName: string };
/** Login name → full name for the accounts the viewer may meet on a screen. */
export type Directory = Record<string, string>;

export type SessionInfo = {
  id: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
};

// The office identity the branch owner edits on /branding. `version` is the row's updatedAt in
// milliseconds and busts the image URLs (`/api/branding/<kind>?v=`).
export type BrandingSummary = { siteName: string; tagline: string; hasLogo: boolean; hasFavicon: boolean; version: number };
export type BrandingBody = { siteName: string; tagline: string; logo: string | null; logoDark: string | null; favicon: string | null };

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
    city?: string;
    address?: string;
    nextPassword?: string;
    currentPassword?: string;
  }) => request<Profile>('PATCH', '/auth/profile', patch),
  listSessions: () => request<{ sessions: SessionInfo[] }>('GET', '/auth/sessions'),
  revokeSession: (id: string) => request<{ ok: true }>('DELETE', `/auth/sessions/${segment(id)}`),
  setupTwoFactor: () => request<{ otpauth: string }>('POST', '/auth/two-factor/setup'),
  confirmTwoFactor: (code: string) => request<{ next: Next }>('POST', '/auth/two-factor/confirm', { code }),
  verifyTwoFactor: (code: string) => request<{ next: Next }>('POST', '/auth/two-factor/verify', { code }),
  branding: () => request<BrandingSummary>('GET', '/branding'),
  saveBranding: (body: BrandingBody) => request<BrandingSummary>('PUT', '/branding', body),
  officeMe: () => request<OfficeMe>('GET', '/office/me'),
  officeDirectory: () => request<{ names: Directory }>('GET', '/office/directory'),
  officeHome: () => request<HomePayload>('GET', '/office/home'),
  postAnnouncement: (body: string) => request<{ ok: true }>('POST', '/office/announcements', { body }),
  fundWallet: (loginName: string, amount: number, note: string) =>
    request<{ ok: true }>('POST', `/office/wallets/${segment(loginName)}/fund`, { amount, note }),
  setCeiling: (loginName: string, ceiling: number) =>
    request<{ ok: true }>('PATCH', `/office/wallets/${segment(loginName)}/ceiling`, { ceiling }),
  officePackages: () => request<{ packages: PackageRow[]; companies: { name: string; image: string }[] }>('GET', '/office/packages'),
  officeCompanies: () => request<Shelf>('GET', '/office/companies'),
  setCompanyImage: (name: string, image: string) => request<{ ok: true }>('POST', '/office/companies/image', { name, image }),
  setCompanySim: (code: string, sim: SimRules & { esimPrice: number }) =>
    request<{ ok: true; sim: SimRules; esimPrice: number }>('PUT', `/office/companies/${segment(code)}/sim`, sim),
  setSellPrice: (code: string, price: number, renewalPrice?: number | null) =>
    request<{ price: number; renewalPrice: number | null }>('PUT', `/office/sell-prices/${segment(code)}`, { price, renewalPrice }),
  officeProviders: () => request<{ providers: ProviderRow[] }>('GET', '/office/providers'),
  providerSettings: (code: string) =>
    request<ProviderSettings>('GET', `/office/providers/${segment(code)}/settings`),
  setProviderEsimPrice: (code: string, price: number | null) =>
    request<{ ok: true; esimPrice: number | null }>('PATCH', `/office/providers/${segment(code)}/esim-price`, { price }),
  setProviderMode: (code: string, action: string, mode: string) =>
    request<{ ok: true }>('PATCH', `/office/providers/${segment(code)}/settings`, { action, mode }),
  officeLines: (query?: { q?: string; status?: string; packageCode?: string; provider?: string; company?: string; cursor?: string | null }) =>
    request<{ lines: LineRow[]; poses: PosChoice[]; nextCursor: string | null; total: number }>('GET', `/office/lines${queryString(query)}`),
  officeLine: (id: string) => request<{ line: LineRow; history: LineHistory[] }>('GET', `/office/lines/${segment(id)}`),
  activateLine: (body: ActivateBody) => request<ApplyResult>('POST', '/office/lines', body),
  officeAudit: (query?: { action?: string; result?: string; layer?: string; q?: string; from?: string; to?: string; cursor?: string | null }) =>
    request<{ entries: ActivityRow[]; nextCursor: string | null; total: number }>('GET', `/office/audit${queryString(query)}`),
  officeFinance: (query?: { kind?: string; layer?: string; q?: string; from?: string; to?: string; cursor?: string | null }) =>
    request<{ entries: FinanceRow[]; nextCursor: string | null; total: number }>('GET', `/office/finance${queryString(query)}`),
  officeProviderOperations: (query?: { kind?: string; provider?: string; q?: string; from?: string; to?: string; cursor?: string | null }) =>
    request<{ entries: ProviderOpRow[]; nextCursor: string | null; total: number; stats: ProviderOpStats; providers: { code: string; name: string }[] }>('GET', `/office/provider-operations${queryString(query)}`),
  officeLedger: (scope: string, query: { kind?: string; direction?: string; from?: string; to?: string; cursor?: string | null }) =>
    request<{ entries: LedgerRow[]; nextCursor: string | null; total: number }>('GET', `/office/ledger/${segment(scope)}${queryString(query)}`),
  extendLine: (id: string, outcome: Outcome) => request<ApplyResult>('POST', `/office/lines/${segment(id)}/extend`, { outcome }),
  reactivateLine: (id: string, outcome: Outcome) => request<ApplyResult>('POST', `/office/lines/${segment(id)}/reactivate`, { outcome }),
  chargeLine: (id: string, outcome: Outcome) => request<ApplyResult>('POST', `/office/lines/${segment(id)}/charge`, { outcome }),
  refreshLine: (id: string, outcome: Outcome) => request<ApplyResult>('POST', `/office/lines/${segment(id)}/refresh`, { outcome }),
  renameLine: (id: string, msisdn: string, outcome: Outcome) =>
    request<ApplyResult>('POST', `/office/lines/${segment(id)}/rename`, { msisdn, outcome }),
  swapSim: (id: string, sim: { iccid: string; esim?: boolean; qr?: string | null }, outcome: Outcome) =>
    request<ApplyResult>('POST', `/office/lines/${segment(id)}/sim`, { ...sim, outcome }),
  requestEsim: (id: string) => request<ApplyResult>('POST', `/office/lines/${segment(id)}/esim`),
  disconnectQuote: (id: string) => request<DisconnectQuote>('GET', `/office/lines/${segment(id)}/disconnect-quote`),
  disconnectLine: (id: string, outcome: Outcome) =>
    request<ApplyResult>('POST', `/office/lines/${segment(id)}/disconnect`, { outcome }),
  freezeLine: (id: string, outcome: Outcome) => request<ApplyResult>('POST', `/office/lines/${segment(id)}/freeze`, { outcome }),
  unfreezeLine: (id: string, outcome: Outcome) => request<ApplyResult>('POST', `/office/lines/${segment(id)}/unfreeze`, { outcome }),
  switchLine: (id: string, packageCode: string, outcome: Outcome) =>
    request<ApplyResult>('POST', `/office/lines/${segment(id)}/switch`, { packageCode, outcome }),
  officeNotices: (query?: { cursor?: string | null; group?: string; unread?: boolean }) =>
    request<{ unread: number; notices: NoticeRow[]; nextCursor: string | null; total: number }>(
      'GET',
      `/office/notices${queryString({ cursor: query?.cursor ?? undefined, group: query?.group, unread: query?.unread ? '1' : undefined })}`,
    ),
  readNotices: (id?: string) => request<{ ok: true }>('POST', '/office/notices/read', id ? { id } : {}),
  officeTasks: (query?: {
    q?: string;
    status?: string;
    action?: string;
    packageCode?: string;
    company?: string;
    provider?: string;
    cursor?: string | null;
  }) => request<{ tasks: TaskRow[]; nextCursor: string | null; total: number }>('GET', `/office/tasks${queryString(query)}`),
  officeTask: (id: string) => request<{ task: TaskDetail; events: TaskEvent[] }>('GET', `/office/tasks/${segment(id)}`),
  addTaskNote: (id: string, text: string) => request<{ ok: true }>('POST', `/office/tasks/${segment(id)}/notes`, { text }),
  takeTask: (id: string) => request<{ ok: true }>('POST', `/office/tasks/${segment(id)}/take`),
  releaseTask: (id: string) => request<{ ok: true }>('POST', `/office/tasks/${segment(id)}/release`),
  completeTask: (id: string, body: CompleteTaskBody) => request<{ ok: true }>('POST', `/office/tasks/${segment(id)}/complete`, body),
  rejectTask: (id: string, reason: string) => request<{ ok: true }>('POST', `/office/tasks/${segment(id)}/reject`, { reason }),
  cancelTask: (id: string) => request<{ ok: true }>('POST', `/office/tasks/${segment(id)}/cancel`),
  officeUsers: () => request<{ users: UserRow[] }>('GET', '/office/users'),
  officeAccount: (loginName: string) => request<AccountAccess>('GET', `/office/users/${segment(loginName)}`),
  saveAccountAccess: (loginName: string, body: { extraGrants: string[]; deniedGrants: string[]; extraRoleIds: string[]; roleId?: string }) =>
    request<{ ok: true }>('PATCH', `/office/users/${segment(loginName)}/access`, body),
  createUser: (body: { loginName: string; nickname: string; password: string; layer: string; parentLogin?: string; roleId?: string }) =>
    request<{ ok: true }>('POST', '/office/users', body),
  officeRoles: () => request<{ roles: RoleRow[] }>('GET', '/office/roles'),
  saveRole: (body: { id?: string; name: string; grants: string[]; read: boolean; edit: boolean; accounting: boolean; tasks: boolean; reports: boolean; staff: boolean; enter: boolean }) =>
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
    esimPrice: number | null;
  }>) =>
    request<{ ok: true }>('PATCH', `/office/packages/${segment(code)}/chain`, body),
  repriceRenewal: (code: string, which: string, posPrice: number) =>
    request<{ ok: true; lines: number }>('POST', `/office/packages/${segment(code)}/reprice-renewal`, { which, posPrice }),
  setPackageRenewals: (code: string, targets: string[]) =>
    request<{ ok: true }>('PUT', `/office/packages/${segment(code)}/renewals`, { targets }),
  setPackageSwitches: (code: string, targets: string[]) =>
    request<{ ok: true }>('PUT', `/office/packages/${segment(code)}/switches`, { targets }),
  customPrices: (code: string) => request<CustomPriceRow[]>('GET', `/office/packages/${segment(code)}/custom-prices`),
  setCustomPrice: (code: string, loginName: string, body: { price?: number | null; renewalPrice?: number | null }) =>
    request<CustomPriceRow>('PUT', `/office/packages/${segment(code)}/custom-prices/${segment(loginName)}`, body),
  clearCustomPrice: (code: string, loginName: string) =>
    request<{ ok: true }>('DELETE', `/office/packages/${segment(code)}/custom-prices/${segment(loginName)}`),
  userPackages: (loginName: string) => request<UserPackagesSheet>('GET', `/office/users/${segment(loginName)}/packages`),
  setUserPackage: (loginName: string, code: string, body: { hidden?: boolean; price?: number | null; renewalPrice?: number | null }) =>
    request<UserPackageRow>('PUT', `/office/users/${segment(loginName)}/packages/${segment(code)}`, body),
  setUserPackagesBulk: (loginName: string, codes: string[], hidden: boolean) =>
    request<{ summary: UserPackagesSummary }>('PUT', `/office/users/${segment(loginName)}/packages`, { codes, hidden }),
  userOps: (loginName: string) => request<UserOps>('GET', `/office/users/${segment(loginName)}/ops`),
  setUserOps: (loginName: string, denied: string[]) => request<UserOps>('PUT', `/office/users/${segment(loginName)}/ops`, { denied }),
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
  operations: { id: string; at: string; kind: string; amount: number; note: string | null; packageName: string | null; loginName: string }[];
  announcements: { id: string; body: string; at: string; authorName: string; authorLayer: string }[];
};
export type PackageRow = {
  code: string;
  name: string;
  providerCode?: string;
  providerName: string;
  activateMode?: 'auto' | 'manual' | 'off';
  companyName: string;
  sim: SimRules;
  esimPrice: number;
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
  /** What the caller pays for this package after its own custom price and its parent's sell price. */
  price: number;
  renewalPrice: number;
  canActivate: boolean;
};
export type UserPackagesSummary = { total: number; visible: number; custom: number };
export type UserPackageRow = {
  code: string;
  name: string;
  dataGb: number | null;
  months: number;
  companyCode: string;
  hidden: boolean;
  hiddenAbove: string | null;
  parentBuy: number;
  parentRenewalBuy: number;
  price: number | null;
  renewalPrice: number | null;
  effective: number;
  renewalEffective: number;
  source: 'custom' | 'parent' | 'layer';
};
export type UserPackagesSheet = {
  summary: UserPackagesSummary;
  companies: { code: string; name: string; packages: UserPackageRow[] }[];
};
export type UserOps = { denied: string[]; deniedAbove: { op: string; login: string }[] };
export type CustomPriceRow = {
  loginName: string;
  nickname: string;
  layer: string;
  parentLogin: string;
  defaultPrice: number;
  defaultRenewalPrice: number;
  price: number | null;
  renewalPrice: number | null;
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
export type ProviderSettings = {
  code: string;
  name: string;
  modes: Record<string, 'auto' | 'manual' | 'off'>;
  esimPrice: number | null;
};
export type Shelf = {
  companies: {
    code: string;
    name: string;
    image: string;
    sim: SimRules;
    esimPrice: number;
    providers: {
      code: string;
      name: string;
      packages: {
        code: string;
        name: string;
        months: number;
        forSale: boolean;
        enabled: boolean;
        lines: number;
        activeLines: number;
        stoppedLines: number;
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
  esimPrice: number | null;
  esimPriceEffective: number;
  esimPriceSource: 'package' | 'provider' | 'company';
  lines: number;
  activeLines: number;
  renewals: string[];
  switches: string[];
  modes: Record<string, 'auto' | 'manual' | 'off'>;
};
export type RoleRow = {
  id: string;
  name: string;
  kind?: 'layer' | 'job';
  layer?: string;
  grants?: string[];
  read: boolean;
  edit: boolean;
  accounting: boolean;
  tasks: boolean;
  reports: boolean;
  staff: boolean;
  enter: boolean;
};
export type AccountAccess = {
  loginName: string;
  nickname: string;
  layer: string;
  parentLogin: string | null;
  frozen: boolean;
  isBranchOwner: boolean;
  staff: boolean;
  roleId: string;
  roleName: string;
  roleGrants: string[];
  extraGrants: string[];
  deniedGrants: string[];
  extraRoleIds: string[];
  grants: string[];
  roles: { id: string; name: string; grants: string[] }[];
  canEdit: boolean;
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
  total?: number;
};
export type LineRow = {
  id: string;
  msisdn: string;
  iccid: string | null;
  esim: boolean;
  esimQr: string | null;
  status: string;
  packageCode: string;
  packageName: string;
  companyName: string;
  posLogin: string;
  posPrice: number;
  createdAt: string;
  endsAt: string;
  operations: string[];
  opsLocked?: boolean;
  dataGb?: number | null;
  subscriberPrice?: number;
  companyImage?: string;
  lastRechargeAt?: string | null;
  esimPrice?: number;
  sim?: SimRules;
  switchTargets?: string[];
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
type ActivateBody = { packageCode: string; posLogin: string; esim: boolean; iccid: string; msisdn: string; currentDetails?: string; outcome: Outcome };
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
export type ActivityRow = {
  id: string;
  at: string;
  action: string;
  result: string;
  reason: string;
  ip: string;
  actorLogin: string;
  actorLayer: string;
  subjectKind: string;
  subjectRef: string;
};
export type ProviderOpStats = { count: number; cost: number; monthCost: number };
export type ProviderOpRow = {
  id: string;
  at: string;
  kind: string;
  msisdn: string;
  providerCode: string;
  providerName: string;
  companyName: string;
  packageName: string;
  cost: number;
  /** The eSIM fee inside this operation's cost, when it sold or issued an eSIM. */
  esimPrice: number | null;
};
export type FinanceRow = {
  id: string;
  at: string;
  loginName: string;
  layer: string;
  actorLogin: string;
  kind: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  msisdn: string;
  companyName: string;
  packageName: string;
  packagePrice: number | null;
  /** The eSIM fee inside `amount`, when the sale was an eSIM. */
  esimPrice: number | null;
  note: string;
};
/** What an immediate activation hands back: the line as the provider issued it. */
export type IssuedLine = { id: string; msisdn: string; iccid: string | null; esim: boolean; esimQr: string | null };
export type ApplyResult = { applied: boolean; debited?: boolean; taskId?: string; line?: IssuedLine };
/** What a disconnect would return to the point of sale now (agorot, the fee already taken), and whether it runs at once. */
export type DisconnectQuote = {
  amount: number;
  runsNow: boolean;
};
export type SimRules = {
  length: number | null;
  prefix: string;
  esim: boolean;
};
export type NoticePayload = {
  taskId?: string;
  action?: string;
  msisdn?: string | null;
  packageName?: string;
  amount?: number;
  handlerName?: string;
  authorName?: string;
  excerpt?: string;
  reason?: string;
  senderName?: string;
  note?: string;
  balance?: number;
  ceiling?: number;
  attempted?: number;
  loginName?: string;
  announcementId?: string;
};
export type NoticeRow = {
  id: string;
  kind: string;
  payload: NoticePayload;
  actorName: string;
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
  companyName: string;
  providerName: string;
  note: string | null;
  resultNote: string | null;
  lastNote: string | null;
  log?: string;
  canTake: boolean;
  canWork: boolean;
  canCancel: boolean;
};
export type CompleteTaskBody = { note: string; iccid?: string; qr?: string | null; msisdn?: string };
export type TaskDetail = TaskRow & {
  createdAt: string;
  updatedAt: string;
  iccid: string | null;
  esim: boolean;
  esimQr: string | null;
  sim: SimRules;
  lineStatus: string | null;
  companyName: string;
  providerName: string;
  canNote: boolean;
};
export type TaskEvent = {
  id: string;
  kind: 'system' | 'note' | 'result';
  body: string;
  authorName: string | null;
  at: string;
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
