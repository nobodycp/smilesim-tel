// The pieces that draw a company without its own picture: the letters on its mark, the colour behind
// them, and the shrinking of an uploaded logo into a data URL the API stores.
import { shrinkImage } from './branding-image';

// "Cell Com" -> "CC"; a single word keeps its first two letters; never more than three.
export function markOf(name: string): string {
  const parts = name.split(' ').filter(Boolean);
  return (parts.length > 1 ? parts.map((part) => part[0]).join('') : name.slice(0, 2)).slice(0, 3);
}

// A hue in 0..359 taken from the name, so a company keeps the same colour on every screen.
export function hueOf(name: string): number {
  return [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
}

// The colour behind the white letters. At 42% saturation a lightness of 33% keeps white at 4.5:1 or more on every
// hue (the worst, yellow at 60°, is 4.67:1); the table's 13px letters need that, not only the large ones.
export function markColor(name: string): string {
  return `hsl(${hueOf(name)} 42% 33%)`;
}

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const LOGO_SIDE = 256;
/** Decoded bytes a company mark may have (decision 11): the API's `COMPANY_IMAGE_BYTES`. */
export const LOGO_LIMIT = 50_000;
const LOGO_QUALITIES = [0.86, 0.75, 0.6];

// A picked file as a webp data URL no larger than 256px on a side and 50 KB, with the logo's and the offers'
// `shrinkImage` (speed plan PF.7). Empty when the file is not a png, jpeg, or webp, cannot be decoded, or is still
// over 50 KB at the lowest quality.
export function compactImage(file: File): Promise<string> {
  return shrinkImage(file, LOGO_SIDE, { types: LOGO_TYPES, limit: LOGO_LIMIT, qualities: LOGO_QUALITIES });
}
