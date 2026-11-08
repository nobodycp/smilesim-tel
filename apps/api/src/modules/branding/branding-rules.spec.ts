import { OfficeFailure } from '../office/office-failure';
import { brandingSummary, decodeImage, parseBrandingBody } from './branding-rules';

describe('branding rules', () => {
  const png = `data:image/png;base64,${Buffer.alloc(64, 1).toString('base64')}`;

  it('trims names and keeps images', () => {
    expect(parseBrandingBody({ siteName: ' Pro ', tagline: '', logo: png, logoDark: png, favicon: null })).toEqual({
      siteName: 'Pro',
      tagline: '',
      logo: png,
      logoDark: png,
      favicon: null,
    });
  });

  it('treats a missing or empty image as none', () => {
    expect(parseBrandingBody({ siteName: '', tagline: '', logo: '' })).toEqual({
      siteName: '',
      tagline: '',
      logo: null,
      logoDark: null,
      favicon: null,
    });
  });

  it('refuses a name over 120 characters and a tagline over 160', () => {
    expect(() => parseBrandingBody({ siteName: 'x'.repeat(121), tagline: '' })).toThrow(OfficeFailure);
    expect(() => parseBrandingBody({ siteName: '', tagline: 'x'.repeat(161) })).toThrow(OfficeFailure);
    expect(parseBrandingBody({ siteName: 'x'.repeat(120), tagline: 'y'.repeat(160) }).siteName).toHaveLength(120);
  });

  it('refuses a jpeg and an oversize image', () => {
    const jpeg = `data:image/jpeg;base64,${Buffer.alloc(64, 1).toString('base64')}`;
    const big = `data:image/png;base64,${Buffer.alloc(300_001, 1).toString('base64')}`;
    expect(() => parseBrandingBody({ siteName: '', tagline: '', logo: jpeg })).toThrow(OfficeFailure);
    expect(() => parseBrandingBody({ siteName: '', tagline: '', favicon: big })).toThrow(OfficeFailure);
    expect(() => parseBrandingBody({ siteName: '', tagline: '', favicon: 'not a url' })).toThrow(OfficeFailure);
  });

  it('refuses a body that is not an object', () => {
    expect(() => parseBrandingBody(null)).toThrow(OfficeFailure);
    expect(() => parseBrandingBody({ siteName: 5 })).toThrow(OfficeFailure);
  });

  it('decodes a data url to bytes and a type', () => {
    expect(decodeImage(png)).toEqual({ type: 'image/png', bytes: Buffer.alloc(64, 1) });
    expect(decodeImage(null)).toBeNull();
    expect(decodeImage('garbage')).toBeNull();
  });

  it('summarises a missing row as version 0 with defaults', () => {
    expect(brandingSummary(null)).toEqual({ siteName: '', tagline: '', hasLogo: false, hasFavicon: false, version: 0 });
  });

  it('summarises a row with its updatedAt as the version', () => {
    const updatedAt = new Date('2026-11-05T09:00:00Z');
    expect(brandingSummary({ siteName: 'Pro', tagline: 'Desk', logo: png, logoDark: null, favicon: null, updatedAt })).toEqual({
      siteName: 'Pro',
      tagline: 'Desk',
      hasLogo: true,
      hasFavicon: false,
      version: updatedAt.getTime(),
    });
  });
});
