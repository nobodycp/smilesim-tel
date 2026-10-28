export const SESSION_LIMIT = 3;
export const SESSION_TTL_SECONDS = 2592000;

type Row = {
  id: string;
  createdAt: Date;
  scope: 'full' | 'password_change' | 'two_factor';
  kind: 'account' | 'impersonation';
  revokedAt?: Date | null;
};

export function idsToRevoke(existing: Row[], creatingNewFullSession: boolean): string[] {
  const countable = existing
    .filter((row) => row.kind === 'account' && row.scope === 'full' && !row.revokedAt)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const overflow = countable.length + (creatingNewFullSession ? 1 : 0) - SESSION_LIMIT;
  if (overflow <= 0) return [];
  return countable.slice(0, overflow).map((row) => row.id);
}

export function isListedAccountSession(row: Pick<Row, 'scope' | 'kind' | 'revokedAt'>): boolean {
  return row.kind === 'account' && row.scope === 'full' && !row.revokedAt;
}
