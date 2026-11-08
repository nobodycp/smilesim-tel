// Shapes of what the office API sends and takes. Split out of lib/api.ts (Phase 4.3); lib/api.ts re-exports them.

export type Next = 'password' | 'two_factor_enroll' | 'two_factor_code' | 'app';

// A failure carries the Arabic `message` the API sent and, from an API that has the error contract,
// the stable `code` (see apps/api/src/errors.ts). Decisions and translations go by `code`.
export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; message: string; code?: string };

/** `nickname` carries the full name; the field keeps its historical name. `city` is a key from lib/cities.ts. */
export type Profile = { nickname?: string; email?: string; phone?: string; city?: string; address?: string };
export type AccountProfile = Profile & { loginName: string };
/** Login name → full name for the accounts the viewer may meet on a screen. */
export type Directory = Record<string, string>;

export type TwoFactorMethod = 'app' | 'sms' | 'email';
export type PasskeyInfo = { id: string; name: string; createdAt: string; lastUsedAt: string | null };
/** GET /auth/sign-in-methods: how this account signs in. Contacts come masked. */
export type SignInMethods = {
  twoFactorEnabled: boolean;
  twoFactorMethod: TwoFactorMethod;
  canDisable: boolean;
  phone: string | null;
  email: string | null;
  passkeys: PasskeyInfo[];
};
/** A code sent by SMS or email; `sent` false means one went out less than `retryIn` seconds ago. */
export type CodeSent = { sentTo: string; sent: boolean; retryIn: number };

/** One level of session rules; null follows the next level (account → layer → default). */
export type SessionRuleValues = { maxSessions: number | null; sessionMinutes: number | null };
export type SessionRuleResult = { maxSessions: number; sessionMinutes: number };
export type LayerKey = 'branch' | 'main_agent' | 'agent' | 'pos';
export type SessionRulesView = { defaults: SessionRuleResult; layers: Record<LayerKey, SessionRuleValues> };
export type UserSettings = { loginName: string; email: string; phone: string; twoFactorEnabled: boolean; twoFactorExempt: boolean; twoFactorMethod: string };
export type AccountSessionRules = { own: SessionRuleValues; layer: SessionRuleResult; effective: SessionRuleResult };

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


export type Outcome = 'success' | 'fail';
export type OfficeMe = {
  loginName: string;
  nickname: string;
  layer: string;
  isBranchOwner: boolean;
  grants: string[];
  stops: string[];
  impersonating: boolean;
  balance: number;
  ceiling: number;
};
export type HomePayload = {
  pendingTasks: number;
  activeLines: number;
  inactiveLines: number;
  /** Active lines ending within three days. */
  expiringLines: number;
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
  /** Package details: null = not stated, -1 = unlimited. */
  smsCount: number | null;
  minutes: number | null;
  details: string;
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
  /** The caller's own sell price to the layer below, and the layer column it replaces; null for branch and pos. */
  sellPrice: number | null;
  sellRenewalPrice: number | null;
  sellDefault: number | null;
  sellRenewalDefault: number | null;
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
  /** Renewable lines of this package on points of sale under this user. */
  lines: number;
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
/** The renewable numbers of one package in a scope, grouped by the renewal price each carries (agorot). `current` is what a new activation would carry on the scope account; `null` for the whole system. */
export type LinePrices = { current: number | null; groups: { price: number; count: number }[] };
/** One group's new price: a flat price in agorot, or `'current'` to follow what a new activation carries. */
export type LinePriceChange = { from: number; to: number | 'current' };
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
        dataGb: number | null;
        smsCount: number | null;
        minutes: number | null;
        branchCost: number;
        mainPrice: number;
        renewalBranchCost: number;
        renewalMainPrice: number;
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
  dataGb: number | null;
  smsCount: number | null;
  minutes: number | null;
  details: string;
  months: number;
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
  /** The account as the users list shows it: wallet and what the viewer may do. */
  listed: UserRow | null;
};
export type UserRow = {
  loginName: string;
  nickname: string;
  layer: string;
  roleName: string;
  parentLogin: string | null;
  balance: number;
  ceiling: number;
  /** Money held for open tasks (roadmap N6). */
  held: number;
  frozen: boolean;
  self: boolean;
  directChild: boolean;
  canEnter: boolean;
  canFreeze: boolean;
  canDelete: boolean;
};
/** What a move does to the terms written on an account: `keep` leaves them, `reset` deletes them. */
export type TransferReset = 'keep' | 'reset';
/** What a move does to the renewal price each moved number carries: `keep` it, or `recapture` it under the new parent. */
export type TransferLinePrices = 'keep' | 'recapture';
/** The choices of an account move. Every one is stated, none has a default; the `child` ones are for an agent only. */
export type TransferAccountBody = {
  parentLogin: string;
  ownPrices: TransferReset;
  ownStops: TransferReset;
  childPrices?: TransferReset;
  childStops?: TransferReset;
  linePrices: TransferLinePrices;
};
/** What a move would carry, counted before anything is written. Balances are agorot; `child` is null for a point of sale. */
export type TransferPreview = {
  balance: number;
  subtreeBalance: number;
  own: { customPrices: number; hidden: number; stops: number; belowNewFloor: number };
  child: { customPrices: number; hidden: number; stops: number; sellPrices: number } | null;
  lines: number;
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
export type ActivateBody = { packageCode: string; posLogin: string; esim: boolean; iccid: string; msisdn: string; currentDetails?: string; outcome: Outcome };
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
  /** The account whose wallet moved (the operations scope covers the viewer's tree). */
  loginName: string;
  layer: string;
  /** What the viewer earned on this operation; null when it is not a sale in its chain. */
  margin: number | null;
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
/** One account's share of a sale, as the branch reads it on a finance row. */
export type FinanceShare = { loginName: string; layer: string; margin: number };
export type FinanceRow = {
  /** For the branch: every account's share of the sale, branch first; null otherwise. */
  shares: FinanceShare[] | null;
  /** Why a manual movement was made: deposit, return, correction or settlement. */
  reason: string | null;
  /** For a hold or a release: the amount held (positive) or freed (negative). */
  held: number | null;
  /** What the signed-in account earned on this sale; null when it is not a sale in its chain. */
  margin: number | null;
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
  /** `transfer.out` and `transfer.in`: what moved, its msisdn or login, and the other account. */
  kind?: 'line' | 'pos' | 'agent';
  subject?: string;
  fromLogin?: string;
  toLogin?: string;
  actorName?: string;
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
export type ReportRow = {
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

/** The signed-in account's wallet over the last 30 days (`GET /office/finance/summary`). */
export type FinanceSummary = {
  balance: number;
  ceiling: number;
  /** Money held for open tasks. */
  held: number;
  /** The branch has no ceiling. */
  unlimited: boolean;
  moneyIn: number;
  moneyOut: number;
  count: number;
  /** What the signed-in account earned on the sales in its chain over the 30 days, and how many sales. */
  profit: number;
  sales: number;
  series: { day: string; balance: number }[];
};

/** The signed-in account's profit by package over a period (`GET /office/finance/profits`). */
export type ProfitRow = { packageName: string; companyName: string; sales: number; refunds: number; profit: number };
export type ProfitReport = { packages: ProfitRow[]; totals: { sales: number; refunds: number; profit: number }; capped: boolean };

/** Rows of the «التقارير» page (`GET /office/reports/{sales,orders,balances,supply}`). */
export type SaleReportRow = { id: string; at: string; loginName: string; kind: string; msisdn: string; companyName: string; packageName: string; amount: number; margin: number | null };
export type OrderReportRow = { id: string; at: string; loginName: string; action: string; msisdn: string; companyName: string; packageName: string; status: 'done' | 'open' | 'cancelled'; amount: number };
export type BalanceReportRow = {
  loginName: string; nickname: string; layer: string; parentLogin: string | null; balance: number; ceiling: number; used: number; held: number; available: number; frozen: boolean; lastAt: string | null;
};
export type SupplyReportRow = { providerCode: string; providerName: string; operations: number; cost: number; profit: number };

/** Our account with one provider (`GET /office/provider-accounts`): payments + settlements − purchases. */
export type ProviderAccount = {
  code: string; name: string; purchases: number; payments: number; settlements: number;
  balance: number; creditLimit: number; held: number; available: number;
};
export type ProviderLedgerRow = {
  id: string; at: string; kind: string; amount: number; balanceAfter: number; note: string; msisdn: string; packageName: string; actorLogin: string;
};
export type ProviderAccountDetail = { summary: ProviderAccount; ledger: ProviderLedgerRow[]; capped: boolean };

/** Reconciliation with a provider (roadmap N8). */
export type StatementMap = { msisdn: number; date: number; amount: number; reference?: number | null };
export type StatementPreview = { columns: string[]; sample: string[][]; rows: number; map: Partial<StatementMap> };
export type ReconCounts = { matched: number; different: number; missing_ours: number; missing_theirs: number; duplicate: number; skipped?: number };
export type ReconItem = {
  id: string; kind: 'different' | 'missing_ours' | 'missing_theirs' | 'duplicate'; msisdn: string; at: string | null;
  theirAmount: number | null; ourAmount: number | null; reference: string | null; status: 'open' | 'resolved'; note: string | null; resolvedBy: string | null;
};
export type ReconRunSummary = {
  id: string; at: string; fileName: string; periodFrom: string | null; periodTo: string | null; statementTotal: number; ourTotal: number;
  counts: ReconCounts; open: number; actorLogin: string;
};
export type ReconRun = Omit<ReconRunSummary, 'open'> & { providerCode: string; providerName: string; items: ReconItem[] };
