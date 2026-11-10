import { isSealed, open, seal, tryOpen } from './secret-box';

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

  it('tryOpen answers a value that was never sealed as it is, with or without a key', () => {
    const plain = 'data:image/png;base64,QUJDREVGRw==';
    process.env.SECRETS_KEY = key;
    expect(tryOpen(plain)).toEqual({ value: plain });
    delete process.env.SECRETS_KEY;
    expect(tryOpen(plain)).toEqual({ value: plain });
    expect(tryOpen('')).toEqual({ value: '' });
  });

  it('tryOpen opens what was sealed with the key in use', () => {
    process.env.SECRETS_KEY = key;
    const secret = 'LPA:1$smdp.example.com$ACTIVATION-CODE-123';
    expect(tryOpen(seal(secret))).toEqual({ value: secret });
  });

  it('tryOpen never throws and never hands back any part of a sealed value it cannot open', () => {
    process.env.SECRETS_KEY = key;
    const secret = 'LPA:1$smdp.example.com$ACTIVATION-CODE-123';
    const sealed = seal(secret);
    const [, iv, tag, body] = sealed.split(':');
    const damaged = [
      `v1:${iv}:${tag}:${body.slice(0, -2)}AA`,
      `v1:${iv}:${tag.slice(0, -2)}AA:${body}`,
      `v1:${iv}:${tag}`,
      'v1:',
      'v1:not-a-sealed-value-at-all',
      `v1:${iv}:${tag}:${body}:extra`,
    ];
    for (const stored of damaged) {
      const read = tryOpen(stored);
      expect([stored.length, read]).toEqual([stored.length, { unreadable: 'unreadable' }]);
      // Nothing of the stored text, the secret or the cipher's own error comes back.
      expect(Object.keys(read)).toEqual(['unreadable']);
    }
    // Sealed with another key: it does not open.
    process.env.SECRETS_KEY = Buffer.alloc(32, 9).toString('base64');
    expect(tryOpen(sealed)).toEqual({ unreadable: 'unreadable' });
    // No key, or a key of the wrong size: said as such.
    delete process.env.SECRETS_KEY;
    expect(tryOpen(sealed)).toEqual({ unreadable: 'no-key' });
    process.env.SECRETS_KEY = Buffer.alloc(16, 1).toString('base64');
    expect(tryOpen(sealed)).toEqual({ unreadable: 'no-key' });
  });
});
