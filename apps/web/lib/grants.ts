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
