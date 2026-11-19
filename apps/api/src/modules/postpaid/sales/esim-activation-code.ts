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

/**
 * Whether a text is an eSIM activation code as a provider hands one back: `LPA:1$<SM-DP+ address>$<matching id>`,
 * with an optional confirmation part, in printable characters without spaces. What a person types into a decision
 * is held to it before it is sealed, so a note or a number typed in the wrong field never becomes a line's code.
 */
export function isActivationCode(text: string): boolean {
  return /^LPA:1\$[A-Za-z0-9.-]+\$[\x21-\x7E]*$/.test(text) && !/\s/.test(text);
}

