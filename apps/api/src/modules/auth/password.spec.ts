import { hashPassword, passwordMatches } from './password';

describe('password', () => {
  it('verifies an Argon2id hash and rejects a different password', async () => {
    const hash = await hashPassword('12345678');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await passwordMatches(hash, '12345678')).toBe(true);
    expect(await passwordMatches(hash, '12345679')).toBe(false);
  });

  it('a stored value that is not an argon2 hash matches nothing, and does not throw', async () => {
    for (const stored of ['', 'x', 'plain-text-password', '$argon2id$broken']) expect({ stored, matches: await passwordMatches(stored, 'x') }).toEqual({ stored, matches: false });
  });
});
