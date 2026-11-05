/** One shekel is 100 agorot. The API speaks agorot; the screen speaks shekels. */
export const AGOROT = 100;

export function formatShekel(agorot: number): string {
  const sign = agorot < 0 ? '-' : '';
  const abs = Math.abs(Math.round(agorot));
  const whole = Math.floor(abs / AGOROT);
  const frac = String(abs % AGOROT).padStart(2, '0');
  return `${sign}${whole}.${frac} ₪`;
}

export function shekelField(agorot: number): string {
  const sign = agorot < 0 ? '-' : '';
  const abs = Math.abs(Math.round(agorot));
  const whole = Math.floor(abs / AGOROT);
  const frac = abs % AGOROT;
  return frac === 0 ? `${sign}${whole}` : `${sign}${whole}.${String(frac).padStart(2, '0')}`;
}

/** A shekel amount typed by a person, returned as agorot. Two decimal places at most. */
export function parseShekel(value: string): number | null {
  const text = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  const agorot = Number(whole) * AGOROT + Number(frac.padEnd(2, '0'));
  if (!Number.isInteger(agorot) || agorot > 100_000_000) return null;
  return agorot;
}
