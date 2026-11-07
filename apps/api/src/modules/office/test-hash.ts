import { hashPassword } from '../auth/password';

// argon2 is slow on purpose. Specs that build a fresh office per test hash the same password once per file,
// so a full parallel run does not push single tests past the Jest timeout.
const hashes = new Map<string, Promise<string>>();

export function hashOnce(password: string): Promise<string> {
  let hash = hashes.get(password);
  if (!hash) {
    hash = hashPassword(password);
    hashes.set(password, hash);
  }
  return hash;
}
