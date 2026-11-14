export const GRANT_CODES = [
  'read',
  'edit',
  'accounting',
  'tasks',
  'reports',
  'staff',
  'enter',
  'transferLines',
  'transferPos',
  'transferAgents',
] as const;

export type GrantCode = (typeof GRANT_CODES)[number];

const GRANT_SET = new Set<string>(GRANT_CODES);

export const FLAG_CODES = ['read', 'edit', 'accounting', 'tasks', 'reports', 'staff', 'enter'] as const;

// What that layer can do before anyone adds a feature. A later permission is a new code here
// and on the role; one account can then be allowed or blocked without changing the others.
export const LAYER_GRANTS: Record<string, readonly GrantCode[]> = {
  branch: [...GRANT_CODES],
  main_agent: ['read', 'accounting', 'tasks', 'transferLines', 'transferPos'],
  agent: ['read', 'accounting', 'tasks', 'transferLines'],
  pos: ['read', 'accounting'],
};

export type GrantRole = {
  grants?: string | null;
  read?: boolean;
  edit?: boolean;
  accounting?: boolean;
  tasks?: boolean;
  reports?: boolean;
  staff?: boolean;
  enter?: boolean;
};

export function splitGrants(value: string | null | undefined): GrantCode[] {
  if (!value) return [];
  const seen = new Set<GrantCode>();
  for (const part of value.split(',')) {
    const code = part.trim();
    if (GRANT_SET.has(code)) seen.add(code as GrantCode);
  }
  return [...seen];
}

export function roleGrantCodes(role: GrantRole | null | undefined): GrantCode[] {
  if (!role) return [];
  if (role.grants && role.grants.trim()) return splitGrants(role.grants);
  return FLAG_CODES.filter((code) => role[code] === true);
}

export function flagsFor(codes: readonly string[]) {
  const set = new Set(codes);
  return {
    read: set.has('read'),
    edit: set.has('edit'),
    accounting: set.has('accounting'),
    tasks: set.has('tasks'),
    reports: set.has('reports'),
    staff: set.has('staff'),
    enter: set.has('enter'),
  };
}

export function effectiveGrantCodes(input: {
  owner: boolean;
  staff: boolean;
  layer: string;
  layerRole: GrantRole | null;
  roles: Array<GrantRole | null | undefined>;
  extra: string | null | undefined;
  denied: string | null | undefined;
}): GrantCode[] {
  if (input.owner) return [...GRANT_CODES];
  const set = new Set<GrantCode>();
  if (!input.staff) {
    const layerCodes = input.layerRole ? roleGrantCodes(input.layerRole) : (LAYER_GRANTS[input.layer] ?? []);
    for (const code of layerCodes) set.add(code);
  }
  for (const role of input.roles) {
    for (const code of roleGrantCodes(role)) set.add(code);
  }
  for (const code of splitGrants(input.extra)) set.add(code);
  for (const code of splitGrants(input.denied)) set.delete(code);
  return GRANT_CODES.filter((code) => set.has(code));
}
