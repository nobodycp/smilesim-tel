/** One shekel is 100 agorot. Money columns store agorot. */
export const AGOROT = 100;
/** Five shekels, what a point of sale pays for an eSIM when no company, provider, or package says otherwise. Kept out of a disconnect split. */
export const ESIM_PRICE_DEFAULT = 5 * AGOROT;

export type EsimPriceSource = 'package' | 'provider' | 'company';
type PricedEsim = { esimPrice?: number | null } | null | undefined;

/** The package price wins, then the provider, then the company. A company without a price is the default. */
export function esimPriceOf(parts: { pkg?: PricedEsim; provider?: PricedEsim; company?: PricedEsim }): { price: number; source: EsimPriceSource } {
  if (typeof parts.pkg?.esimPrice === 'number') return { price: parts.pkg.esimPrice, source: 'package' };
  if (typeof parts.provider?.esimPrice === 'number') return { price: parts.provider.esimPrice, source: 'provider' };
  if (typeof parts.company?.esimPrice === 'number') return { price: parts.company.esimPrice, source: 'company' };
  return { price: ESIM_PRICE_DEFAULT, source: 'company' };
}

/**
 * What the branch pays the provider for an activation: the subscription branch cost, plus the eSIM fee when
 * the line is an eSIM. The eSIM fee is the same price the point of sale pays; there is no separate cost.
 * Stored on the wallet entry so provider operations read it back as it was on the day.
 */
export function activationProviderCost(subscriptionBranchCost: number, esim: boolean, esimFee: number): number | undefined {
  return esim ? subscriptionBranchCost + esimFee : undefined;
}
/** Half a shekel. The provider's disconnect fee, inside the one disconnect posting. */
export const DISCONNECT_FEE = AGOROT / 2;
/** A charged or extended package month is 30 days, not a calendar month. */
export const PERIOD_DAYS = 30;

export type PriceField = 'main' | 'agent' | 'pos' | 'subscriber';

export type Prices = {
  branchCost: number;
  mainPrice: number;
  agentPrice: number;
  posPrice: number;
  subscriberPrice: number;
};

export type PackageTerms = {
  code: string;
  companyCode: string;
  providerCode: string;
  months: number;
  forSale: boolean;
  subscription: Prices;
  renewal: Prices;
};

export type RenewalTarget = { code: string; months: number; renewal: Prices };

export type LineTerms = {
  packageCode: string;
  months: number;
  /** Cycle length of the window that ends at `endsAt`, when it differs from `months`. */
  windowMonths?: number;
  subscription: Prices;
  renewal: Prices;
  renewalTargets: RenewalTarget[];
};

export function periodEnd(from: Date, months: number): Date {
  const next = new Date(from.getTime());
  next.setUTCDate(next.getUTCDate() + PERIOD_DAYS * Math.max(1, months));
  return next;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days left in a paid period. One not started keeps every day, a started day counts as used, a closed one has none. */
function daysLeft(now: Date, endsAt: Date, periodDays: number): number {
  const end = endsAt.getTime();
  const at = now.getTime();
  if (at >= end) return 0;
  const start = end - periodDays * DAY_MS;
  if (at < start) return periodDays;
  const usedDays = Math.min(periodDays, Math.max(1, Math.ceil((at - start) / DAY_MS)));
  return periodDays - usedDays;
}

/** Whole days left in the paid window. A started day counts, and a closed window has none. */
export function remainingDays(now: Date, endsAt: Date, months: number): number {
  return daysLeft(now, endsAt, PERIOD_DAYS * Math.max(1, months));
}

export function windowMonthsOf(line: { months: number; windowMonths?: number }): number {
  return line.windowMonths ?? line.months;
}

/** A paid period still open on a line: its length, the whole days left, and what those days are worth. */
export type OpenPeriod = { days: number; left: number; value: number; renewal: boolean };

/** A wallet row that bought time (or, for a switch, repriced it), as stored. */
export type PrepaidRow = {
  kind: string;
  packagePrice: number | null;
  periodDays: number | null;
  periodEndsAt: Date | null;
};

const RUN_START_KINDS = new Set(['activate', 'charge', 'reactivate']);
const RENEWAL_PERIOD_KINDS = new Set(['charge', 'extend', 'reactivate']);

/**
 * Paid periods still open, read from the prepaid rows newest first back to the row that started the
 * current run. The newest switch reprices every older period. Null when a row in the run has no period.
 */
export function openPeriods(now: Date, rows: PrepaidRow[]): OpenPeriod[] | null {
  const open: OpenPeriod[] = [];
  let repriced: { price: number; days: number } | null = null;
  for (const row of rows) {
    if (!row.periodDays || row.packagePrice === null) return null;
    if (row.kind === 'switch') {
      repriced ??= { price: row.packagePrice, days: row.periodDays };
      continue;
    }
    if (!row.periodEndsAt) return null;
    if (now.getTime() < row.periodEndsAt.getTime()) {
      const left = daysLeft(now, row.periodEndsAt, row.periodDays);
      const rate = repriced ?? { price: row.packagePrice, days: row.periodDays };
      open.push({ days: row.periodDays, left, value: Math.round((rate.price * left) / rate.days), renewal: RENEWAL_PERIOD_KINDS.has(row.kind) });
    }
    if (RUN_START_KINDS.has(row.kind)) break;
  }
  return open;
}

/** The last window alone, for lines whose rows carry no periods. */
export function lastWindow(now: Date, endsAt: Date, months: number, price: number, renewal: boolean): OpenPeriod[] {
  const days = PERIOD_DAYS * Math.max(1, months);
  if (now.getTime() >= endsAt.getTime()) return [];
  const left = daysLeft(now, endsAt, days);
  return [{ days, left, value: Math.round((price * left) / days), renewal }];
}

/**
 * One disconnect posting for a line with paid days left.
 * The point of sale is credited every unused paid day minus the half-shekel fee.
 * The provider cost is the used share of the running period's branch cost plus that same fee.
 * A line with no open period is not a disconnect: the subscription lapsed.
 */
export function settleDisconnect(
  periods: OpenPeriod[],
  branchCostOf: (renewal: boolean) => number,
): { amount: number; providerCost: number } | null {
  const running = periods[periods.length - 1];
  if (!running) return null;
  const refund = periods.reduce((sum, period) => sum + period.value, 0);
  const used = Math.round((branchCostOf(running.renewal) * (running.days - running.left)) / running.days);
  return { amount: refund - DISCONNECT_FEE, providerCost: used + DISCONNECT_FEE };
}

export function disconnectSettlement(input: {
  now: Date;
  endsAt: Date;
  months: number;
  posPrice: number;
  branchCost: number;
}): { amount: number; providerCost: number } | null {
  return settleDisconnect(lastWindow(input.now, input.endsAt, input.months, input.posPrice, false), () => input.branchCost);
}

export function captureTerms(pkg: PackageTerms, targets: PackageTerms[]): LineTerms {
  return {
    packageCode: pkg.code,
    months: pkg.months,
    subscription: { ...pkg.subscription },
    renewal: { ...pkg.renewal },
    renewalTargets: targets.map((target) => ({
      code: target.code,
      months: target.months,
      renewal: { ...target.renewal },
    })),
  };
}

export function subscriptionDebit(pkg: PackageTerms): number {
  return pkg.subscription.posPrice;
}

export function chargeDebit(line: LineTerms): number {
  return line.renewal.posPrice;
}

const RENEWAL_COST_KINDS = new Set(['charge', 'extend', 'reactivate']);
const SUBSCRIPTION_COST_KINDS = new Set(['activate', 'switch']);

/** What the branch pays the provider for one line operation. Other kinds cost nothing. */
export function providerBranchCost(
  kind: string,
  terms: { subscription?: { branchCost?: number }; renewal?: { branchCost?: number } } | null,
  fallback: { branchCost: number; renewalBranchCost: number } | null,
): number {
  const renewal = RENEWAL_COST_KINDS.has(kind);
  if (!renewal && !SUBSCRIPTION_COST_KINDS.has(kind)) return 0;
  const saved = (renewal ? terms?.renewal : terms?.subscription)?.branchCost;
  if (typeof saved === 'number') return saved;
  if (!fallback) return 0;
  return renewal ? fallback.renewalBranchCost : fallback.branchCost;
}

export function renewStay(
  line: LineTerms,
  from: Date,
): { endsAt: Date; debit: number; terms: LineTerms } {
  return {
    endsAt: periodEnd(from, line.months),
    debit: line.renewal.posPrice,
    terms: { ...line, windowMonths: line.months },
  };
}

export function renewOnto(
  line: LineTerms,
  target: PackageTerms,
  from: Date,
):
  | { endsAt: Date; debit: number; terms: LineTerms }
  | { error: 'NOT_A_RENEWAL_TARGET' } {
  const saved = line.renewalTargets.find((item) => item.code === target.code);
  if (!saved) return { error: 'NOT_A_RENEWAL_TARGET' as const };
  const renewal = { ...saved.renewal };
  return {
    endsAt: periodEnd(from, saved.months),
    debit: renewal.posPrice,
    terms: {
      ...captureTerms({ ...target, months: saved.months, subscription: renewal, renewal }, []),
      windowMonths: saved.months,
    },
  };
}

export function repriceRenewal(
  line: LineTerms,
  which: { kind: 'stay' } | { kind: 'target'; code: string },
  posPrice: number,
): LineTerms | { error: 'NO_TARGET' } {
  if (which.kind === 'stay') {
    return { ...line, renewal: { ...line.renewal, posPrice } };
  }
  const found = line.renewalTargets.some((item) => item.code === which.code);
  if (!found) return { error: 'NO_TARGET' };
  return {
    ...line,
    renewalTargets: line.renewalTargets.map((item) =>
      item.code === which.code ? { ...item, renewal: { ...item.renewal, posPrice } } : item,
    ),
  };
}

/**
 * Value of the days still left on the new package, minus the same days on the current one.
 * A positive difference is a debit. The open window length is the denominator of the current price.
 */
export function switchDifference(input: {
  now: Date;
  endsAt: Date;
  windowMonths: number;
  currentPrice: number;
  newPrice: number;
  newMonths: number;
}): { currentValue: number; newValue: number; difference: number } {
  const window = lastWindow(input.now, input.endsAt, input.windowMonths, input.currentPrice, false);
  return switchOver(window, input.newPrice, input.newMonths);
}

/** Every day left in the open periods, valued on the new package, against what those days are worth now. */
export function switchOver(
  periods: OpenPeriod[],
  newPrice: number,
  newMonths: number,
): { currentValue: number; newValue: number; difference: number } {
  const days = periods.reduce((sum, period) => sum + period.left, 0);
  const currentValue = periods.reduce((sum, period) => sum + period.value, 0);
  const newValue = Math.round((newPrice * days) / (PERIOD_DAYS * Math.max(1, newMonths)));
  return { currentValue, newValue, difference: newValue - currentValue };
}

/** The same open periods at another full-period price, such as the branch cost. */
export function revalue(periods: OpenPeriod[], priceOf: (period: OpenPeriod) => number): OpenPeriod[] {
  return periods.map((period) => ({ ...period, value: Math.round((priceOf(period) * period.left) / period.days) }));
}

export function switchOnto(
  line: LineTerms,
  current: PackageTerms,
  target: PackageTerms,
  allowedCodes: string[],
):
  | { terms: LineTerms }
  | { error: 'SAME_PACKAGE' | 'OTHER_SHELF' | 'NOT_ALLOWED' } {
  if (target.code === line.packageCode) return { error: 'SAME_PACKAGE' as const };
  if (target.companyCode !== current.companyCode || target.providerCode !== current.providerCode) {
    return { error: 'OTHER_SHELF' as const };
  }
  if (!allowedCodes.includes(target.code)) return { error: 'NOT_ALLOWED' as const };
  const renewal = { ...target.renewal };
  return {
    terms: {
      ...captureTerms({ ...target, subscription: renewal, renewal }, []),
      windowMonths: windowMonthsOf(line),
    },
  };
}

export type AccountNode = { id: string; parentId: string | null; layer: string };

export function withinCeiling(layer: string, balance: number, ceiling: number, debit: number): boolean {
  if (debit <= 0) return true;
  if (layer === 'branch') return true;
  return balance - debit >= -ceiling;
}

export function chainHolds(prices: Prices): boolean {
  return (
    prices.mainPrice >= prices.branchCost &&
    prices.agentPrice >= prices.mainPrice &&
    prices.posPrice >= prices.agentPrice &&
    prices.subscriberPrice >= prices.posPrice
  );
}

export function withPrice(prices: Prices, field: PriceField, price: number): Prices {
  if (field === 'main') return { ...prices, mainPrice: price };
  if (field === 'agent') return { ...prices, agentPrice: price };
  if (field === 'pos') return { ...prices, posPrice: price };
  return { ...prices, subscriberPrice: price };
}

export function editableField(layer: string): PriceField | null {
  if (layer === 'branch') return 'main';
  if (layer === 'main_agent') return 'agent';
  if (layer === 'agent') return 'pos';
  return null;
}

export function visibleAccountIds(actorId: string, actorLayer: string, nodes: AccountNode[]): Set<string> {
  if (actorLayer === 'branch') return new Set(nodes.map((node) => node.id));
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const list = children.get(node.parentId) ?? [];
    list.push(node.id);
    children.set(node.parentId, list);
  }
  const seen = new Set<string>([actorId]);
  const stack = [actorId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    for (const child of children.get(id) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      stack.push(child);
    }
  }
  return seen;
}

export type ActionMode = 'auto' | 'manual' | 'off';

export const ACTION_KEYS = [
  'activate',
  'charge',
  'extend',
  'disconnect',
  'freeze',
  'switch',
  'rename',
  'sim',
  'companySwitch',
] as const;

export type ActionKey = (typeof ACTION_KEYS)[number];

export type ActionModes = Record<ActionKey, ActionMode>;

export type PackageActionFlags = {
  autoActivate: boolean;
  allowActivate: boolean;
  autoCharge: boolean;
  allowCharge: boolean;
  autoExtend: boolean;
  allowExtend: boolean;
  autoDisconnect: boolean;
  allowDisconnect: boolean;
  autoFreeze: boolean;
  allowFreeze: boolean;
  autoSwitch: boolean;
  allowSwitch: boolean;
  autoRename: boolean;
  allowRename: boolean;
  autoSim: boolean;
  allowSim: boolean;
};

const MODE_FLAG_FIELDS: Record<Exclude<ActionKey, 'companySwitch'>, { auto: keyof PackageActionFlags; allow: keyof PackageActionFlags }> = {
  activate: { auto: 'autoActivate', allow: 'allowActivate' },
  charge: { auto: 'autoCharge', allow: 'allowCharge' },
  extend: { auto: 'autoExtend', allow: 'allowExtend' },
  disconnect: { auto: 'autoDisconnect', allow: 'allowDisconnect' },
  freeze: { auto: 'autoFreeze', allow: 'allowFreeze' },
  switch: { auto: 'autoSwitch', allow: 'allowSwitch' },
  rename: { auto: 'autoRename', allow: 'allowRename' },
  sim: { auto: 'autoSim', allow: 'allowSim' },
};

export function actionMode(auto: boolean, allow: boolean): ActionMode {
  if (!allow) return 'off';
  return auto ? 'auto' : 'manual';
}

export function flagsForMode(mode: ActionMode): { auto: boolean; allow: boolean } {
  if (mode === 'off') return { auto: false, allow: false };
  if (mode === 'auto') return { auto: true, allow: true };
  return { auto: false, allow: true };
}

export function defaultActionModes(): ActionModes {
  return {
    activate: 'manual',
    charge: 'manual',
    extend: 'manual',
    disconnect: 'manual',
    freeze: 'manual',
    switch: 'manual',
    rename: 'manual',
    sim: 'manual',
    companySwitch: 'manual',
  };
}

export function normalizeActionModes(raw: unknown): ActionModes {
  const next = defaultActionModes();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return next;
  const map = raw as Record<string, unknown>;
  for (const key of ACTION_KEYS) {
    const value = map[key];
    if (value === 'auto' || value === 'manual' || value === 'off') next[key] = value;
  }
  return next;
}

/** One-time copy into Package auto/allow flags when creating a package under a provider. */
export function packageFlagsFromModes(modes: ActionModes): PackageActionFlags {
  const flags = {} as PackageActionFlags;
  for (const key of Object.keys(MODE_FLAG_FIELDS) as Exclude<ActionKey, 'companySwitch'>[]) {
    const pair = MODE_FLAG_FIELDS[key];
    const { auto, allow } = flagsForMode(modes[key]);
    flags[pair.auto] = auto;
    flags[pair.allow] = allow;
  }
  return flags;
}

const MODE_FLAG_READ: Record<Exclude<ActionKey, 'companySwitch'>, { auto: keyof PackageActionFlags; allow: keyof PackageActionFlags }> = MODE_FLAG_FIELDS;

/** Package map wins. A missing key uses the boolean pair, then `manual`. Unfreeze reads freeze. */
export function resolvePackageMode(
  map: unknown,
  flags: Partial<PackageActionFlags>,
  action: ActionKey | 'unfreeze',
): ActionMode {
  const key: ActionKey = action === 'unfreeze' ? 'freeze' : action;
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    const value = (map as Record<string, unknown>)[key];
    if (value === 'auto' || value === 'manual' || value === 'off') return value;
  }
  const pair = key === 'companySwitch' ? undefined : MODE_FLAG_READ[key];
  if (pair && typeof flags[pair.auto] === 'boolean' && typeof flags[pair.allow] === 'boolean') {
    return actionMode(flags[pair.auto] as boolean, flags[pair.allow] as boolean);
  }
  return 'manual';
}

/** Update is direct unless the package map says otherwise. It has no boolean columns. */
export function refreshMode(map: unknown): ActionMode {
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    const value = (map as Record<string, unknown>).refresh;
    if (value === 'auto' || value === 'manual' || value === 'off') return value;
  }
  return 'auto';
}

export type ActivateInput = 'generated' | 'current-details' | 'number-and-sim';

/** Input shape for a new activation. Neod and Tokman are office data, not a call to those providers. */
export function activateInputs(providerCode: string): ActivateInput {
  if (providerCode === 'neod') return 'current-details';
  if (providerCode === 'tokman') return 'number-and-sim';
  return 'generated';
}

export type SimRules = { length: number | null; prefix: string; esim: boolean };
export type SimRefusal = 'SIM_DIGITS' | 'SIM_LENGTH' | 'SIM_PREFIX';

export const SIM_LENGTH_MIN = 10;
export const SIM_LENGTH_MAX = 22;
const SIM_PREFIX_MAX = 10;

export function simRulesOf(company: { iccidLength?: number | null; iccidPrefix?: string | null; esim?: boolean } | null): SimRules {
  if (!company) return { length: null, prefix: '', esim: true };
  return { length: company.iccidLength ?? null, prefix: company.iccidPrefix ?? '', esim: company.esim ?? true };
}

/** A company with no length and no prefix checks nothing here; the caller keeps its own minimum. */
export function simRefusal(rules: SimRules, iccid: string): SimRefusal | null {
  if (rules.length === null && !rules.prefix) return null;
  if (!/^\d+$/.test(iccid)) return 'SIM_DIGITS';
  if (rules.length !== null && iccid.length !== rules.length) return 'SIM_LENGTH';
  if (rules.prefix && !iccid.startsWith(rules.prefix)) return 'SIM_PREFIX';
  return null;
}

/** Default serial length for a company that sets none: the usual 19-digit ICCID. */
export const SIM_LENGTH_DEFAULT = 19;

/**
 * A serial the simulated provider issues for a new eSIM: the company prefix followed by random
 * digits up to the company length. Always satisfies `simRefusal` for the same rules.
 */
export function issueSerial(rules: SimRules, random: () => number = Math.random): string {
  const length = rules.length ?? SIM_LENGTH_DEFAULT;
  let serial = rules.prefix;
  while (serial.length < length) serial += Math.floor(random() * 10).toString();
  return serial.slice(0, length);
}

export function readSimRules(body: { length?: unknown; prefix?: unknown; esim?: unknown }): SimRules | null {
  const length = body.length ?? null;
  if (length !== null && (!Number.isInteger(length) || (length as number) < SIM_LENGTH_MIN || (length as number) > SIM_LENGTH_MAX)) return null;
  if (typeof body.prefix !== 'string' || typeof body.esim !== 'boolean') return null;
  const prefix = body.prefix.trim();
  if (prefix && (!/^\d+$/.test(prefix) || prefix.length > SIM_PREFIX_MAX)) return null;
  if (length !== null && prefix.length >= (length as number)) return null;
  return { length: length as number | null, prefix, esim: body.esim };
}

export type RunKey = Exclude<ActionKey, 'companySwitch' | 'activate'> | 'unfreeze';

/** Operations a run screen may show. `companySwitch` stays hidden until it has fields. */
export function offeredOperations(
  line: { status: string; endsAt: Date; opsLocked: boolean },
  modeOf: (action: ActionKey | 'unfreeze') => ActionMode,
  now = new Date(),
): RunKey[] {
  const allowed = (keys: RunKey[]) => keys.filter((key) => modeOf(key) !== 'off');
  if (line.opsLocked) return allowed(['switch']);
  if (line.status === 'disconnected') return allowed(['charge']);
  if (line.status === 'frozen') return allowed(['unfreeze']);
  // A suspended line offers nothing until its rules are decided; any unknown status is treated the same.
  if (line.status !== 'active') return [];
  const keys: RunKey[] = ['switch', 'disconnect', 'sim', 'freeze', 'rename'];
  if (line.endsAt.getTime() > now.getTime()) keys.unshift('extend');
  return allowed(keys);
}

export function isAutomatic(
  flags: {
    autoActivate: boolean;
    autoCharge: boolean;
    autoDisconnect: boolean;
    autoFreeze: boolean;
    autoSwitch: boolean;
    autoExtend?: boolean;
    autoRename?: boolean;
    autoSim?: boolean;
  },
  action: string,
): boolean {
  if (action === 'activate' || action === 'reactivate') return flags.autoActivate;
  if (action === 'charge') return flags.autoCharge;
  if (action === 'extend') return flags.autoExtend ?? flags.autoCharge;
  if (action === 'disconnect') return flags.autoDisconnect;
  if (action === 'freeze' || action === 'unfreeze') return flags.autoFreeze;
  if (action === 'switch') return flags.autoSwitch;
  if (action === 'rename') return flags.autoRename ?? false;
  if (action === 'sim') return flags.autoSim ?? false;
  return false;
}
