/**
 * For a spec that stores eSIM codes: a sealing key of its own for the length of the file, and the environment as
 * it was afterwards. Without a key a code is refused, never stored as written (ADR 0019, D17; S.5b).
 */
export function useSealingKey(key: string = Buffer.alloc(32, 5).toString('base64')): void {
  let before: string | undefined;
  beforeAll(() => {
    before = process.env.SECRETS_KEY;
    process.env.SECRETS_KEY = key;
  });
  afterAll(() => {
    if (before === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = before;
  });
}
