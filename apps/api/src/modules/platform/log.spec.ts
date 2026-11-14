import { errorCode } from './log';

const SECRET = 'Bearer sk_live_abc123';
const coded = (code: unknown) => errorCode(Object.assign(new Error(`connect failed to https://user:pass@host (${SECRET})`), { code, stack: `Error: ${SECRET}\n    at adapter.ts:1:1` }));

describe('errorCode', () => {
  it('keeps the codes it knows by name', () => {
    const known = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ERR_SOCKET_CLOSED', 'UND_ERR_CONNECT_TIMEOUT', 'CERT_HAS_EXPIRED', 'P1001', 'P2002', 'P2025'];
    expect(known.map(coded)).toEqual(known);
  });

  it('turns a code it does not know into unclassified, however much it looks like one', () => {
    // Shaped like a system, Node or undici code, and carrying data.
    for (const code of ['EAPIKEYABC123456789', 'ERR_SECRET_ABCDEF123456', 'UND_ERR_PASSWORD']) expect(coded(code)).toBe('unclassified');
    // Real-looking codes that are simply not on the list, and near misses of ones that are.
    for (const code of ['EACCES', 'ERR_INVALID_ARG_TYPE', 'UND_ERR_INFO', 'P9999', 'P2002 ', ' ECONNRESET', 'ECONNRESET\n' + SECRET, 'econnreset', 'ECONNRESETX', 'XECONNRESET']) {
      expect(coded(code)).toBe('unclassified');
    }
    // Not a string at all, or the names every object has.
    for (const code of [401, null, undefined, { code: 'ECONNRESET' }, ['ECONNRESET'], 'constructor', 'toString', '__proto__', 'has']) {
      expect(coded(code)).toBe('unclassified');
    }
  });

  it('never passes on the message, the stack or anything else of the error', () => {
    expect(errorCode(new Error(SECRET))).toBe('unclassified');
    expect(errorCode(SECRET)).toBe('unclassified');
    expect(errorCode(null)).toBe('unclassified');
    expect(errorCode(undefined)).toBe('unclassified');
    expect(errorCode({ message: SECRET, stack: SECRET, name: SECRET, code: SECRET })).toBe('unclassified');
    // Whatever goes in, what comes out is a listed code or one of two fixed words.
    for (const code of ['ECONNRESET', 'EAPIKEYABC123456789', SECRET, 42]) expect(coded(code)).not.toContain('sk_live');
  });

  it('names a timeout by the error\'s type, not by its words', () => {
    expect(errorCode(Object.assign(new Error(SECRET), { name: 'TimeoutError' }))).toBe('timeout');
    // A listed code still wins; an unlisted one does not hide the timeout.
    expect(errorCode(Object.assign(new Error(SECRET), { name: 'TimeoutError', code: 'ETIMEDOUT' }))).toBe('ETIMEDOUT');
    expect(errorCode(Object.assign(new Error(SECRET), { name: 'TimeoutError', code: 'UND_ERR_PASSWORD' }))).toBe('timeout');
    // A plain object that only claims the name is not an error.
    expect(errorCode({ name: 'TimeoutError' })).toBe('unclassified');
    expect(errorCode(Object.assign(new Error('TimeoutError'), { name: 'Error' }))).toBe('unclassified');
  });
});
