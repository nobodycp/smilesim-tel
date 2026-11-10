import { toDataURL } from 'qrcode';

// The simulated provider's eSIM profile: an LPA activation string rendered as a PNG data URL, the
// same shape the office stores when an employee uploads a picture from a real provider.

const SMDP = 'smdp.smilesim.local';

export function activationCode(msisdn: string, iccid: string): string {
  return `LPA:1$${SMDP}$${msisdn}-${iccid}`;
}

export async function renderEsimQr(msisdn: string, iccid: string): Promise<string> {
  return toDataURL(activationCode(msisdn, iccid), { type: 'image/png', width: 480, margin: 2, errorCorrectionLevel: 'M' });
}
