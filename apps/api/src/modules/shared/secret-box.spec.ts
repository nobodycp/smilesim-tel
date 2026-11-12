import { isSealed, open, seal, tryOpen } from './secret-box';

/**
 * A sealed value with one bit of one byte changed, in its nonce (part 0), its authentication tag (part 1) or its
 * ciphertext (part 2). The byte is changed after decoding and the part encoded again, so the stored bytes always
 * differ. Replacing the last characters of the text does not do that: base64url leaves unused bits in the last
 * character of a part, and the characters put in may be the ones already there.
 */
function withByteChanged(sealed: string, part: 0 | 1 | 2, index: number): string {
  const parts = sealed.slice(3).split(':').map((text) => Buffer.from(text, 'base64url'));
  if (index < 0 || index >= parts[part].length) throw new RangeError('no such byte');
  parts[part][index] ^= 0x01;
  const changed = `v1:${parts.map((bytes) => bytes.toString('base64url')).join(':')}`;
  if (changed === sealed) throw new Error('the value was not changed');
  return changed;
}

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
    // One byte of the authentication tag changed: the last, the first, one in the middle.
    for (const index of [15, 0, 7]) expect(() => open(withByteChanged(sealed, 1, index))).toThrow();
    process.env.SECRETS_KEY = Buffer.alloc(32, 9).toString('base64');
    expect(() => open(sealed)).toThrow();
    delete process.env.SECRETS_KEY;
    expect(() => open(sealed)).toThrow();
  });

  it('refuses a value with any single byte changed: every byte of the tag, the nonce and the ciphertext, for many values', () => {
    process.env.SECRETS_KEY = key;
    const values = ['JBSWY3DPEHPK3PXP', 'a', 'LPA:1$smdp.example.com$ACTIVATION-CODE-123', 'x'.repeat(300)];
    // Many nonces, so every ending of the encoded text is met: the old check failed for about one value in 255.
    for (let round = 0; round < 300; round += 1) {
      const value = values[round % values.length];
      const sealed = seal(value);
      const [nonce, tag, body] = sealed.slice(3).split(':').map((text) => Buffer.from(text, 'base64url'));
      expect([nonce.length, tag.length, body.length]).toEqual([12, 16, Buffer.byteLength(value)]);
      const changes: [0 | 1 | 2, number][] = [
        ...Array.from({ length: 16 }, (_, index): [0 | 1 | 2, number] => [1, index]),
        ...Array.from({ length: 12 }, (_, index): [0 | 1 | 2, number] => [0, index]),
        [2, 0], [2, body.length - 1], [2, Math.floor(body.length / 2)],
      ];
      for (const [part, index] of changes) {
        const changed = withByteChanged(sealed, part, index);
        expect(() => open(changed)).toThrow();
        expect(tryOpen(changed)).toEqual({ unreadable: 'unreadable' });
      }
      expect(open(sealed)).toBe(value);
    }
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
      // One byte changed in the ciphertext, in the tag, in the nonce.
      withByteChanged(sealed, 2, Buffer.from(body, 'base64url').length - 1),
      withByteChanged(sealed, 1, 15),
      withByteChanged(sealed, 0, 0),
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

  // The authenticator secrets are opened by the same `open` (auth/prisma-auth.store.ts). It accepts exactly the
  // three parts `seal` writes; this holds for anything sealed, whatever the value contains.
  it('opens everything it seals: authenticator secrets, values with colons, empty-looking and long ones', () => {
    process.env.SECRETS_KEY = key;
    const base32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const values = ['JBSWY3DPEHPK3PXP', 'a:b:c:d', ':', 'otpauth://totp/Smile:user?secret=JBSWY3DPEHPK3PXP&issuer=Smile', ' ', 'x'.repeat(5000)];
    for (let round = 0; round < 200; round += 1) values.push(Array.from({ length: 32 }, () => base32[Math.floor(Math.random() * 32)]).join(''));
    for (const value of values) {
      const sealed = seal(value);
      expect(sealed.slice(3).split(':')).toHaveLength(3);
      expect(open(sealed)).toBe(value);
    }
  });
});
