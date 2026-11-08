// The pieces that draw a company without its own picture: the letters on its mark, the colour behind
// them, and the shrinking of an uploaded logo into a data URL the API stores.

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
const LOGO_LIMIT = 200_000;

// A picked file as a webp data URL no larger than 256px on a side. Empty when the file is not a
// png, jpeg, or webp, cannot be decoded, or is still over 200 KB after shrinking.
export async function compactImage(file: File): Promise<string> {
  if (!LOGO_TYPES.includes(file.type)) return '';
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return '';
  const scale = Math.min(1, LOGO_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const image = canvas.toDataURL('image/webp', 0.86);
  return image.length < LOGO_LIMIT ? image : '';
}
