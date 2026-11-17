import { REPORT_FRAMES, errorCode, errorReport } from './log';

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

describe('errorReport (system monitor M.4: what is stored of a server error)', () => {
  class LeakyError extends Error {}

  it('keeps the class, a code for the message and the frames of the stack, never the message', () => {
    const error = new LeakyError(`could not save ${SECRET}`);
    error.stack = `Error: could not save ${SECRET}\n    at LinesService.save (/app/apps/api/dist/modules/sales/lines.service.js:12:7)\n    at async Proxy.run (file:///app/node_modules/x/y.js:3:9)\n    at node:internal/process/task_queues:105:5`;
    const report = errorReport(error);
    expect(report).toEqual({
      name: 'LeakyError',
      message: 'unclassified',
      frames: ['LinesService.save (dist/modules/sales/lines.service.js:12:7)', 'async Proxy.run (node_modules/x/y.js:3:9)', 'node:internal/process/task_queues:105:5'],
    });
    expect(JSON.stringify(report)).not.toContain('sk_live');
    // A listed code is the message.
    expect(errorReport(Object.assign(new Error(SECRET), { code: 'P2024' })).message).toBe('P2024');
  });

  it('does not take a line of the message for a frame, and keeps no frame when the message is not where it was', () => {
    const forged = new Error(`bad input\n    at ${SECRET} (/app/dist/${SECRET}.js:1:1)`);
    forged.stack = `Error: ${forged.message}\n    at real (/app/dist/real.js:1:1)`;
    expect(errorReport(forged).frames).toEqual(['real (dist/real.js:1:1)']);
    // The message changed after the stack was made: what precedes the frames cannot be told apart from them.
    const changed = new Error('first');
    changed.stack = `Error: first\n    at ${SECRET} (/x.js:1:1)\n    at real (/app/dist/real.js:1:1)`;
    changed.message = `second ${SECRET}`;
    expect(errorReport(changed).frames).toEqual([]);
  });

  it('keeps only lines shaped like frames, the top ones, and a class name only when it is an identifier', () => {
    const deep = new Error('x');
    deep.stack = ['Error: x', ...Array.from({ length: 30 }, (_, n) => `    at f${n} (/app/dist/f.js:${n + 1}:1)`), `    at ${SECRET}`, '    some note'].join('\n');
    expect(errorReport(deep).frames).toHaveLength(REPORT_FRAMES);
    const named = Object.assign(new Error('x'), { name: `Error ${SECRET}` });
    expect(errorReport(named).name).toBe('Error');
    expect(errorReport(SECRET)).toEqual({ name: 'string', message: 'unclassified', frames: [] });
    expect(errorReport({ message: SECRET })).toEqual({ name: 'Object', message: 'unclassified', frames: [] });
  });
});
