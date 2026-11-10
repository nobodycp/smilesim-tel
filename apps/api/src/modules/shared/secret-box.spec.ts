import { isSealed, open, seal } from './secret-box';

// Review 2026-11-10, S12.
describe('secret box', () => {
  const previous = process.env.SECRETS_KEY;
  const key = Buffer.alloc(32, 7).toString('base64');
  afterEach(() => {
    if (previous === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = previous;
  });

  it('seals a value so it does not appear in what is stored, and opens it again', () => {
    process.env.SECRETS_KEY = key;
    const sealed = seal('JBSWY3DPEHPK3PXP');
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(open(sealed)).toBe('JBSWY3DPEHPK3PXP');
    // A fresh nonce each time, and sealing twice does not wrap twice.
    expect(seal('JBSWY3DPEHPK3PXP')).not.toBe(sealed);
    expect(seal(sealed)).toBe(sealed);
  });

  it('reads a value that was stored before sealing as it is', () => {
    process.env.SECRETS_KEY = key;
    expect(open('JBSWY3DPEHPK3PXP')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('refuses a tampered value, another key, and a sealed value with no key', () => {
    process.env.SECRETS_KEY = key;
    const sealed = seal('JBSWY3DPEHPK3PXP');
    expect(() => open(`${sealed.slice(0, -2)}AA`)).toThrow();
    process.env.SECRETS_KEY = Buffer.alloc(32, 9).toString('base64');
    expect(() => open(sealed)).toThrow();
    delete process.env.SECRETS_KEY;
    expect(() => open(sealed)).toThrow();
  });

  it('seals nothing without a key, or with a key of the wrong size', () => {
    delete process.env.SECRETS_KEY;
    expect(seal('JBSWY3DPEHPK3PXP')).toBe('JBSWY3DPEHPK3PXP');
    process.env.SECRETS_KEY = Buffer.alloc(16, 1).toString('base64');
    expect(seal('JBSWY3DPEHPK3PXP')).toBe('JBSWY3DPEHPK3PXP');
  });
});
