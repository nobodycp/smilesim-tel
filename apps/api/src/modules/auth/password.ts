import * as argon2 from 'argon2';

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

/**
 * Whether `plain` is the password `hash` was made from. A stored value that is not an argon2 hash (an empty or
 * hand-written one) matches nothing: argon2 throws on it, and that would turn a wrong password into a 500.
 */
export async function passwordMatches(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
