export const ESIM_FEE = 5;

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
  subscription: Prices;
  renewal: Prices;
  renewalTargets: RenewalTarget[];
};

export function periodEnd(from: Date, months: number): Date {
  const next = new Date(from.getTime());
  next.setUTCMonth(next.getUTCMonth() + Math.max(1, months));
  return next;
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

export function renewStay(
  line: LineTerms,
  from: Date,
): { endsAt: Date; debit: number; terms: LineTerms } {
  return { endsAt: periodEnd(from, line.months), debit: line.renewal.posPrice, terms: line };
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
    terms: captureTerms({ ...target, months: saved.months, subscription: renewal, renewal }, []),
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

export function switchOnto(
  line: LineTerms,
  current: PackageTerms,
  target: PackageTerms,
  allowedCodes: string[],
  from: Date,
):
  | { endsAt: Date; debit: number; terms: LineTerms }
  | { error: 'SAME_PACKAGE' | 'OTHER_SHELF' | 'NOT_ALLOWED' } {
  if (target.code === line.packageCode) return { error: 'SAME_PACKAGE' as const };
  if (target.companyCode !== current.companyCode || target.providerCode !== current.providerCode) {
    return { error: 'OTHER_SHELF' as const };
  }
  if (!allowedCodes.includes(target.code)) return { error: 'NOT_ALLOWED' as const };
  const renewal = { ...target.renewal };
  return {
    endsAt: periodEnd(from, target.months),
    debit: renewal.posPrice,
    terms: captureTerms({ ...target, subscription: renewal, renewal }, []),
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

const MODE_FLAG_FIELDS: Record<ActionKey, { auto: keyof PackageActionFlags; allow: keyof PackageActionFlags }> = {
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
  for (const key of ACTION_KEYS) {
    const pair = MODE_FLAG_FIELDS[key];
    const { auto, allow } = flagsForMode(modes[key]);
    flags[pair.auto] = auto;
    flags[pair.allow] = allow;
  }
  return flags;
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
