import { errorCode } from './log';

describe('errorCode', () => {
  it('keeps a plain system, Node, undici or Prisma code', () => {
    const coded = (code: unknown) => errorCode(Object.assign(new Error('connect failed to https://user:pass@host'), { code }));
    expect(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ERR_SOCKET_CLOSED', 'UND_ERR_CONNECT_TIMEOUT', 'P2002'].map(coded)).toEqual(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ERR_SOCKET_CLOSED', 'UND_ERR_CONNECT_TIMEOUT', 'P2002']);
  });

  it('never passes on a code that could carry data, nor a message', () => {
    const secret = 'Bearer sk_live_abc123';
    for (const code of [secret, 'token=abc', 'E' + 'X'.repeat(60), 'econnreset', 401, { code: 'ECONNRESET' }, undefined]) {
      expect(errorCode(Object.assign(new Error(secret), { code }))).toBe('unclassified');
    }
    expect(errorCode(new Error(secret))).toBe('unclassified');
    expect(errorCode(secret)).toBe('unclassified');
    expect(errorCode(null)).toBe('unclassified');
    expect(errorCode(Object.assign(new Error(secret), { name: 'TimeoutError' }))).toBe('timeout');
  });
});
