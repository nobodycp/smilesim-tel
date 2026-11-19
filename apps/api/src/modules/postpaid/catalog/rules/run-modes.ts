// How each line operation runs for a package: by the provider now, as a branch task, or not at all. Pure: no
// Nest, no Prisma.

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

/**
 * What to write on a package so `action` runs in `mode`: the whole map (every action as it resolves now, `action`
 * changed) and, for the eight actions with columns, their boolean pair. Shared by a package's own change and by a
 * provider's change reaching the packages that inherit it (spec 2026-11-09-admin-review, 3).
 */
export function packageModeData(map: unknown, flags: Partial<PackageActionFlags>, action: ActionKey, mode: ActionMode): Record<string, unknown> {
  const modes = {} as ActionModes;
  for (const key of ACTION_KEYS) modes[key] = resolvePackageMode(map, flags, key);
  modes[action] = mode;
  const data: Record<string, unknown> = { actionModes: modes };
  const pair = action === 'companySwitch' ? undefined : MODE_FLAG_FIELDS[action];
  if (pair) {
    const next = flagsForMode(mode);
    data[pair.auto] = next.auto;
    data[pair.allow] = next.allow;
  }
  return data;
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
