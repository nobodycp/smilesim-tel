import { toDataURL } from 'qrcode';

// The simulated provider's eSIM profile: an LPA activation string rendered as a PNG data URL, the
// same shape the office stores when an employee uploads a picture from a real provider.

const SMDP = 'smdp.smilesim.local';

export function activationCode(msisdn: string, iccid: string): string {
  return `LPA:1$${SMDP}$${msisdn}-${iccid}`;
}

export async function renderEsimQr(msisdn: string, iccid: string): Promise<string> {
  return renderActivationCode(activationCode(msisdn, iccid));
}

/**
 * An activation code as the picture a line carries: what a provider hands back with a confirmed activation is the
 * code itself (ADR 0019, D11), and a line's eSIM code is shown and scanned as a QR picture.
 */
export function renderActivationCode(code: string): Promise<string> {
  return toDataURL(code, { type: 'image/png', width: 480, margin: 2, errorCorrectionLevel: 'M' });
}
