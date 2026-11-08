import type { Request, Response } from 'express';
import { securityHeaders } from './security-headers';

function headersFor(path: string, production: boolean) {
  const set: Record<string, string> = {};
  const res = { setHeader: (name: string, value: string) => { set[name] = value; }, removeHeader: (name: string) => { delete set[name]; } } as unknown as Response;
  securityHeaders(production)({ path } as Request, res, () => undefined);
  return set;
}

describe('securityHeaders', () => {
  it('denies framing and sniffing, sends no referrer, and locks the content policy', () => {
    expect(headersFor('/office/me', false)).toEqual({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    });
  });

  it('leaves the Swagger page its scripts and adds HSTS in production', () => {
    expect(headersFor('/docs', false)['Content-Security-Policy']).toBeUndefined();
    expect(headersFor('/office/me', true)['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains');
  });
});
