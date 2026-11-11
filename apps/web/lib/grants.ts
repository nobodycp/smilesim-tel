import type { Copy } from './copy';

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

// A transfer grant says what an account may move; the layer that holds it says how far. Each layer names the
// grant in its own words, and a layer with none of its own is named as the branch is, the widest of them.
const labels: Record<GrantCode, (t: Copy, layer: string) => string> = {
  read: (t) => t.grantRead,
  edit: (t) => t.grantEdit,
  accounting: (t) => t.navAccounting,
  tasks: (t) => t.grantTasks,
  reports: (t) => t.navReports,
  staff: (t) => t.staffAccount,
  enter: (t) => t.grantEnter,
  transferLines: (t, layer) =>
    layer === 'agent' ? t.grantTransferLinesAgent : layer === 'main_agent' ? t.grantTransferLinesMain : t.grantTransferLinesBranch,
  transferPos: (t, layer) => (layer === 'main_agent' ? t.grantTransferPosMain : t.grantTransferPosBranch),
  transferAgents: (t) => t.grantTransferAgents,
};

/** The words for a grant on the role of `layer`. A job role belongs to the branch, so it is the default. */
export function grantLabel(t: Copy, code: string, layer = 'branch') {
  return code in labels ? labels[code as GrantCode](t, layer) : code;
}

// What a layer can never use: an agent moves numbers only, a main agent moves no agents, a point of sale moves nothing.
const UNUSABLE: Record<string, readonly string[]> = {
  main_agent: ['transferAgents'],
  agent: ['transferPos', 'transferAgents'],
  pos: ['transferLines', 'transferPos', 'transferAgents'],
};

/** Whether `layer` can ever use `code`. The role of a layer neither shows nor offers what it cannot use. */
export function grantUsable(code: string, layer: string): boolean {
  return !UNUSABLE[layer]?.includes(code);
}

/**
 * The grants in the three groups the role dialog shows (owner 2026-11-11): what a role may see, what it does day to day,
 * and which accounts it may enter and move. A grant added to GRANT_CODES and not listed here lands in the last group.
 */
export const GRANT_GROUPS = [
  { key: 'view', codes: ['read', 'reports', 'accounting'] },
  { key: 'work', codes: ['edit', 'tasks', 'staff'] },
  { key: 'accounts', codes: ['enter', 'transferLines', 'transferPos', 'transferAgents'] },
] as const satisfies readonly { key: string; codes: readonly GrantCode[] }[];

export type GrantGroupKey = (typeof GRANT_GROUPS)[number]['key'];

/** The groups with the codes `layer` can use, each in its order; an empty group is left out. */
export function grantGroupsFor(layer: string): { key: GrantGroupKey; codes: GrantCode[] }[] {
  const listed = new Set<string>(GRANT_GROUPS.flatMap((group) => group.codes));
  const groups = GRANT_GROUPS.map((group) => ({ key: group.key, codes: [...group.codes] as GrantCode[] }));
  groups[groups.length - 1].codes.push(...GRANT_CODES.filter((code) => !listed.has(code)));
  return groups
    .map((group) => ({ ...group, codes: group.codes.filter((code) => grantUsable(code, layer)) }))
    .filter((group) => group.codes.length > 0);
}
