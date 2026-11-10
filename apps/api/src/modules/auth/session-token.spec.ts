import { hashSessionToken, newSessionToken } from './session-token';

// Review 2026-11-10, S6.
describe('session tokens', () => {
  it('makes a long random token each time', () => {
    const tokens = new Set(Array.from({ length: 50 }, newSessionToken));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('hashes a token the way the migration hashed the ids that used to be cookies', () => {
    // encode(sha256('0b8f3a9e-1f43-4a1c-9a57-2f6f5d1c7e10'::bytea), 'hex') in PostgreSQL.
    expect(hashSessionToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hashSessionToken('0b8f3a9e-1f43-4a1c-9a57-2f6f5d1c7e10')).toHaveLength(64);
  });
});
