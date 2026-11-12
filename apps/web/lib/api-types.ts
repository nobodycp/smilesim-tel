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
/**
 * One account of `GET /office/directory`: an account the viewer may meet on a screen. `mine` marks the viewer's own
 * tree; outside it only the name and the layer are told (`parentLoginName` null, `frozen` false).
 */
export type DirectoryRow = { loginName: string; nickname: string; layer: string; parentLoginName: string | null; frozen: boolean; mine: boolean };

export type TwoFactorMethod = 'app' | 'sms' | 'email';
export type PasskeyInfo = { id: string; name: string; createdAt: string; lastUsedAt: string | null };
/** GET /auth/sign-in-methods: how this account signs in. Contacts come masked. */
export type SignInMethods = {
  twoFactorEnabled: boolean;
  twoFactorMethod: TwoFactorMethod;
  canDisable: boolean;
  /** Two-step verification is required of this account (its layer's rule or its own). */
  required: boolean;
  /** The methods it may enrol with: all three, or the one it is held to. */
  allowedMethods: TwoFactorMethod[];
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
export type TwoFactorMode = 'follow' | 'required' | 'optional';
export type UserSettings = {
  loginName: string;
  email: string;
  phone: string;
  twoFactorEnabled: boolean;
  twoFactorExempt: boolean;
  twoFactorMethod: string;
  twoFactorMode: TwoFactorMode;
  /** The method this account must use; null follows its layer's. */
  requiredMethod: TwoFactorMethod | null;
  /** What applies now: whether two-step is required, and the one method it must use (null: any). */
  effective: { required: boolean; method: TwoFactorMethod | null };
};
/** A layer's two-step rule: required or optional, and the default method while required. */
export type LayerTwoFactor = { required: boolean; method: TwoFactorMethod };
export type TwoFactorPolicy = Record<'branch' | 'main_agent' | 'agent' | 'pos', LayerTwoFactor>;
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
/** One ranked row of the overview: a package, company, provider or account, by count or profit. */
export type OverviewRanked = { key: string; label: string; count: number; amount: number; profit: number; nickname?: string };
export type PulseTotals = { count: number; amount: number; activations: number; profit: number };
/** `GET /office/overview` (spec 2026-11-08-overview-and-reports-nav, F). */
export type OverviewPayload = {
  period: 'day' | 'month' | 'all';
  from: string | null;
  lines: { active: number; expiring: number; frozen: number; disconnected: number; suspended: number };
  /** Each slice's change over the period (spec 2026-11-09-admin-review, 6.4); null before the first earlier snapshot. */
  lineChange?: { active: number; expiring: number; frozen: number; disconnected: number; suspended: number } | null;
  sales: { count: number; amount: number; profit: number; refunds: number; refundAmount: number; net: number; activations: number; trend: { day: string; amount: number; profit: number; count: number }[]; capped: boolean };
  top: { packages: OverviewRanked[]; companies: OverviewRanked[]; providers: OverviewRanked[] };
  active: { main_agent: OverviewRanked[]; agent: OverviewRanked[]; pos: OverviewRanked[] };
  users: { counts: { main_agent: number; agent: number; pos: number }; frozen: number; debtors: number; debt: number; ceilings: number; used: number };
  tasks: { pending: number; working: number; done: number; rejected: number; cancelled: number; oldestOpenMinutes: number | null };
  /** The home's period cards: this period, the same span of the one before (null over all time), and the trend. */
  pulse: { current: PulseTotals; previous: PulseTotals | null; trend: (PulseTotals & { at: string })[] };
  providers: { code: string; name: string; operations: number; cost: number; profit: number; balance: number; creditLimit: number; available: number; status: 'working' | 'problem'; problem: 'failures' | 'balance' | null; failures: number; alertFloor: number }[] | null;
};
/** An offer on the home hero (spec 2026-11-09-offers-tasks-addons-wallet-esim, 1). */
export type Offer = {
  id: string; title: string; body: string; image: string | null; actionLabel: string | null; actionHref: string | null;
  seconds: number; active: boolean; position: number; layers: string[]; startsAt: string | null; endsAt: string | null;
};
export type OfferInput = Partial<Omit<Offer, 'id' | 'position'>> & { title?: string };
export type HomePayload = {
  pendingTasks: number;
  /** Pending or being worked on: the sidebar's count beside «المهام». */
  openTasks: number;
  activeLines: number;
  inactiveLines: number;
  /** Active lines ending within three days. */
  expiringLines: number;
  operations: { id: string; at: string; kind: string; amount: number; note: string | null; packageName: string | null; loginName: string }[];
};
export type PackageRow = {
  code: string;
  name: string;
  /** The provider's code and name: told to the branch only (null and empty for every other layer). */
  providerCode: string | null;
  providerName: string;
  /** How an activation runs: the branch's business, null for every other layer. */
  activateMode: 'auto' | 'manual' | 'off' | null;
  /** Whether the package may be sold now (its activation is not turned off). */
  sellable: boolean;
  /** What the activation form asks for: a number the office makes up, the subscriber's current details, or a number and a SIM. */
  activateInput: 'generated' | 'current-details' | 'number-and-sim';
  companyName: string;
  sim: SimRules;
  esimPrice: number;
  dataGb: number | null;
  /** Package details: null = not stated, -1 = unlimited. */
  smsCount: number | null;
  minutes: number | null;
  details: string;
  months: number;
  /**
   * The price columns: a layer is told its own column and the ones below it. The columns of the layers above it
   * are null (never 0): what those layers pay is not this viewer's to see.
   */
  branchCost: number | null;
  mainPrice: number | null;
  agentPrice: number | null;
  posPrice: number;
  subscriberPrice: number;
  editableField: 'main' | 'agent' | 'pos' | null;
  /** How the provider runs each operation: the branch's business, null for every other layer. */
  autoActivate: boolean | null;
  autoCharge: boolean | null;
  autoDisconnect: boolean | null;
  autoFreeze: boolean | null;
  autoSwitch: boolean | null;
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
  parentLoginName: string;
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
    packages: { code: string; name: string; dataGb: number | null; months: number; price: number; enabled: boolean; autoActivate?: boolean }[];
  }[];
};
export type ProviderSettings = {
  code: string;
  name: string;
  modes: Record<string, 'auto' | 'manual' | 'off'>;
  esimPrice: number | null;
};
export type Shelf = {
  /** True when the shelf was cut at the API's cap: what is listed is not every package. */
  capped?: boolean;
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
/** A package's extra operation (spec 2026-11-09, 3). */
export type PackageAddon = { id: string; name: string; price: number; active: boolean; position: number };
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
  /** Days after the end before a line counts as suspended (90 by default). */
  suspendAfterDays: number;
  /** Whether this package may be sold or served as an eSIM (its company must allow it too). */
  esimAvailable?: boolean;
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
  /** The actions that follow the provider, and the provider's own modes (spec 2026-11-09-admin-review, 3). */
  inheritedModes?: string[];
  providerModes?: Record<string, 'auto' | 'manual' | 'off'>;
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
  parentLoginName: string | null;
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
  parentLoginName: string | null;
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
  parentLoginName: string;
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
/**
 * Every list of the API answers this envelope (API `shared/paging.ts`): the rows of one page, the cursor of the
 * next one or null at the end, and how many rows match across every page. A list's own extra keys sit beside it.
 */
export type Page<Row> = { items: Row[]; nextCursor: string | null; total: number };
/** One package of the branch's providers report: what it costs the branch and how many numbers are on it. */
export type ProviderReportRow = { providerName: string; companyName: string; packageName: string; price: number; lines: number };
export type LineRow = {
  id: string;
  msisdn: string;
  iccid: string | null;
  esim: boolean;
  status: string;
  /** The subscription ended at least its package's period ago (90 days by default): «معلّق». */
  suspended: boolean;
  packageCode: string;
  packageName: string;
  companyName: string;
  posLoginName: string;
  posPrice: number;
  createdAt: string;
  endsAt: string;
  operations: string[];
  opsLocked?: boolean;
  dataGb?: number | null;
  /** The point of sale's agent and main agent on the number's card; '' when there is none or the viewer may not see it. */
  agentLoginName?: string;
  mainAgentLoginName?: string;
  /** The package's allowance on the number's card: -1 unlimited, null not set. */
  smsCount?: number | null;
  minutes?: number | null;
  months?: number;
  subscriberPrice?: number;
  companyImage?: string;
  lastRechargeAt?: string | null;
  esimPrice?: number;
  sim?: SimRules;
  switchTargets?: string[];
  /** The package's live extra operations (spec 2026-11-09, 3), on the number's card. */
  addons?: { id: string; name: string; price: number }[];
};
/**
 * One line as `GET /office/lines/:id` answers it. A list row carries no eSIM code (ADR 0019, D17): the detail is
 * the one place a screen reads it from, and the API records each such read.
 */
export type LineDetail = LineRow & { esimQr: string | null };
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
export type ActivateBody = { packageCode: string; posLoginName: string; esim: boolean; iccid: string; msisdn: string; currentDetails?: string; outcome: Outcome };
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
  actorLoginName: string;
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
  actorLoginName: string;
  actorLayer: string;
  subjectKind: string;
  subjectRef: string;
};
/** `matched`, `differences`, `pending`, `differenceAmount`: the simulated matching (spec E), over the dated rows. */
export type ProviderOpStats = { count: number; cost: number; monthCost: number; matched?: number; differences?: number; pending?: number; differenceAmount?: number };
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
  /** Matching, simulated until real providers are connected (spec E). */
  matchSource?: 'api' | 'statement';
  matchState?: 'matched' | 'difference' | 'pending';
  providerAmount?: number | null;
  difference?: number | null;
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
  actorLoginName: string;
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
/**
 * POST office/tasks/:id/provider-decision (ADR 0019, D15): applied at once, left as a proposal for a second
 * account, or on record with the line still to be made (`exception`, which alone carries `reason`).
 */
export type ProviderDecisionAnswer = {
  ok: true;
  outcome: 'applied' | 'proposed' | 'exception';
  reason?: 'number-taken' | 'sim-taken' | 'target-missing' | 'esim-code-missing';
};
/** POST office/tasks/:id/provider-decision/approval: what the second account's answer came to. */
export type ProviderDecisionApprovalAnswer = {
  ok: true;
  outcome: 'approved' | 'refused';
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
  /** `transfer.out` and `transfer.in`: what moved, its msisdn or login, and the other account. */
  kind?: 'line' | 'pos' | 'agent';
  subject?: string;
  fromLoginName?: string;
  toLoginName?: string;
  actorName?: string;
  /** `provider.problem` and `provider.recovered` (spec 2026-11-08-overview-and-reports-nav, G). `reason` is shared. */
  code?: string;
  name?: string;
  failures?: number;
  available?: number;
  alertFloor?: number;
  /** `provider.match_overdue`: the provider's matching period and its last match. */
  matchEveryDays?: number;
  lastMatchedAt?: string | null;
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
  posLoginName: string;
  submitterLoginName: string;
  assigneeLoginName: string | null;
  posDelta: number;
  msisdn: string | null;
  packageName: string;
  companyName: string;
  providerName: string;
  note: string | null;
  resultNote: string | null;
  lastNote: string | null;
  log?: string;
  /** Where the task's provider operation stands; null or absent for a task that never went to a provider. */
  operationPhase?: OperationPhase | null;
  /** When the task was opened (the list since 2026-11-09). */
  createdAt?: string;
  canTake: boolean;
  canWork: boolean;
  canCancel: boolean;
};
/** Where a task's provider operation stands (ADR 0019): the API's `phaseOf`. */
export type OperationPhase = 'requested' | 'pending' | 'unknown' | 'unapplied' | 'exception' | 'applied' | 'failed';
export type ApplyReason = 'number-taken' | 'sim-taken' | 'target-missing' | 'esim-code-missing';
export type ProviderDecision = 'confirm-success' | 'declare-failure' | 'apply-corrected' | 'release-after-success';
/** A task's operation in its detail: `reason` for the branch only; `decisions` when this account reads the decision view. */
export type TaskOperationState = {
  phase: OperationPhase;
  reason: ApplyReason | null;
  decisions: boolean;
};
/** What became of the amount a task held when it opened. */
export type HoldState = 'none' | 'held' | 'captured' | 'released';
/** One step of a decision. It never carries an eSIM code, only that one was supplied. */
export type DecisionRecord = {
  sequence: number;
  type: 'proposed' | 'approved' | 'refused' | 'applied';
  decision: ProviderDecision;
  accountLoginName: string;
  evidenceKind: string | null;
  providerRef: string | null;
  note: string;
  suppliedEsimCode: boolean;
  at: string;
};
/** What both decision reads say of one operation, for the account that asked. */
export type DecisionStanding = {
  phase: OperationPhase | null;
  reason: ApplyReason | null;
  held: number;
  proposal: DecisionRecord | null;
  decisions: ProviderDecision[];
  canApprove: boolean;
  canRefuse: boolean;
  blocked: string | null;
};
/** GET office/tasks/:id/provider-decision. */
export type DecisionView = DecisionStanding & {
  needs: { number: boolean; esimCode: boolean };
  history: DecisionRecord[];
};
/** One row of GET office/provider-decisions. */
export type WaitingDecision = DecisionStanding & {
  taskId: string;
  action: string;
  msisdn: string | null;
  packageName: string;
  posLoginName: string;
  submitterLoginName: string;
  waitingSince: string;
};
export type ProviderDecisionBody = { decision: ProviderDecision; evidenceKind: string; note: string; providerRef?: string; msisdn?: string; iccid?: string; esimCode?: string };
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
  operation?: TaskOperationState | null;
  hold?: HoldState;
  canNote: boolean;
  /** The branch may write a note only the branch reads (spec 2026-11-09, 2). */
  canNoteInternal?: boolean;
};
export type TaskEvent = {
  id: string;
  kind: 'system' | 'note' | 'result';
  /** An internal note: shown to the branch only. */
  internal?: boolean;
  body: string;
  authorName: string | null;
  at: string;
};
export type ReportRow = {
  id: string;
  at: string;
  loginName: string;
  actorLoginName: string;
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
  /** Movements made by hand (funding, taking back) in the window, and the window in days. */
  manual?: number;
  days?: number;
  series: { day: string; balance: number }[];
};

/** The signed-in account's profit by package over a period (`GET /office/finance/profits`). */
export type ProfitRow = { packageName: string; companyName: string; sales: number; refunds: number; profit: number };
export type ProfitReport = { packages: ProfitRow[]; totals: { sales: number; refunds: number; profit: number }; capped: boolean };

/** Rows of the «التقارير» page (`GET /office/reports/{sales,orders,balances,supply}`). */
export type BalanceReportRow = {
  loginName: string; nickname: string; layer: string; parentLoginName: string | null; balance: number; ceiling: number; used: number; held: number; available: number; frozen: boolean; lastAt: string | null;
};
export type SupplyReportRow = { providerCode: string; providerName: string; operations: number; cost: number; profit: number };

/** Our account with one provider (`GET /office/provider-accounts`): payments + settlements − purchases. */
export type ProviderAccount = {
  code: string; name: string; purchases: number; payments: number; settlements: number;
  balance: number; creditLimit: number; alertFloor: number; held: number; available: number;
  matchSource?: 'api' | 'statement'; matchEveryDays?: number; lastMatchedAt?: string | null; matchOverdue?: boolean; openDifferences?: number;
};
export type ProviderLedgerRow = {
  id: string; at: string; kind: string; amount: number; balanceAfter: number; note: string; msisdn: string; packageName: string; actorLoginName: string;
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
  counts: ReconCounts; open: number; actorLoginName: string;
};
export type ReconRun = Omit<ReconRunSummary, 'open'> & { providerCode: string; providerName: string; items: ReconItem[] };

/** The provider's catalog, queried to add a company or a package (spec 2026-11-09-admin-review, 3). */
export type ProviderCatalogCompany = { code: string; name: string; sim: SimRules; esimPrice: number; added: boolean };
export type ProviderCatalogProduct = {
  code: string; name: string; dataGb: number | null; smsCount: number | null; minutes: number | null; months: number; details: string;
  cost: number; renewalCost: number; addons: { name: string; price: number }[]; added: boolean;
};
export type PriceLadder = { branchCost: number; mainPrice: number; agentPrice: number; posPrice: number; subscriberPrice: number };
export type NewPackage = {
  providerCode: string; companyCode: string; productCode: string; name: string;
  dataGb: number | null; smsCount: number | null; minutes: number | null; months: number; details: string; suspendAfterDays: number; esimAvailable: boolean;
  subscription: PriceLadder; renewal: PriceLadder;
  modes: Record<string, 'auto' | 'manual' | 'off' | 'inherit'>;
  addons: { name: string; price: number }[];
};
