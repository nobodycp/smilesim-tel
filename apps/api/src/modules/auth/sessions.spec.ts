import { idsToRevoke, isListedAccountSession, SESSION_LIMIT } from './sessions';

const row = (id: string, minute: number, scope: 'full' | 'password_change' | 'two_factor' = 'full') => ({
  id,
  createdAt: new Date(Date.UTC(2026, 9, 28, 10, minute)),
  scope,
  kind: 'account' as const,
});

describe('sessions', () => {
  it('revokes the oldest full session when a fourth is created', () => {
    const existing = [row('a', 1), row('b', 2), row('c', 3)];
    expect(idsToRevoke(existing, true)).toEqual(['a']);
    expect(SESSION_LIMIT).toBe(3);
  });

  it('ignores password, two-factor, and impersonation rows', () => {
    const existing = [
      row('a', 1),
      row('b', 2),
      { ...row('c', 3), kind: 'impersonation' as const },
      row('d', 4, 'password_change'),
    ];
    expect(idsToRevoke(existing, true)).toEqual([]);
  });

  it('lists only live full account sessions', () => {
    expect(isListedAccountSession({ scope: 'full', kind: 'account', revokedAt: null })).toBe(true);
    expect(isListedAccountSession({ scope: 'two_factor', kind: 'account', revokedAt: null })).toBe(false);
    expect(isListedAccountSession({ scope: 'full', kind: 'impersonation', revokedAt: null })).toBe(false);
  });
});
