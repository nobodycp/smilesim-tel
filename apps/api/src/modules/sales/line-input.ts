import { fail } from '../platform';

/** A mobile number as the resource writes it. */
export const MSISDN = /^05\d{8}$/;

/** The largest QR data URL stored on a line. The client shrinks to about 300 KB first. */
export const QR_LIMIT = 400_000;

/** A QR picture as a data URL. `undefined` when absent, `null` when cleared, otherwise the checked URL. */
export function readQr(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > QR_LIMIT || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) fail(400, 'QR_INVALID');
  return value;
}

/** The period a prepaid wallet entry bought. */
export function periodOf(days: number, endsAt: Date | null) {
  return { days: Math.max(1, days), endsAt };
}
