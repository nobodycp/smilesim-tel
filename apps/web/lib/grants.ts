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
] as const;

export type GrantCode = (typeof GRANT_CODES)[number];

const labels: Record<GrantCode, (t: Copy) => string> = {
  read: (t) => t.grantRead,
  edit: (t) => t.grantEdit,
  accounting: (t) => t.navAccounting,
  tasks: (t) => t.grantTasks,
  reports: (t) => t.navReports,
  staff: (t) => t.staffAccount,
  enter: (t) => t.grantEnter,
  transferLines: (t) => t.grantTransferLines,
  transferPos: (t) => t.grantTransferPos,
};

export function grantLabel(t: Copy, code: string) {
  return code in labels ? labels[code as GrantCode](t) : code;
}
