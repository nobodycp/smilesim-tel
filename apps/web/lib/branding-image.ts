// The browser's share of the office identity: shrinking a picked logo or icon into a webp data
// URL the API stores, and building the dark-theme copy of a logo so black lettering still reads
// on the dark theme. The server stores what it is sent and never derives.

export const LOGO_SIDE = 768;
export const FAVICON_SIDE = 256;
/** Decoded bytes per image; the same bar as the API (`IMAGE_LIMIT` in branding-rules.ts). */
export const IMAGE_LIMIT = 300_000;

const IMAGE_TYPES = ['image/png', 'image/webp'];

function decodedBytes(dataUrl: string): number {
  const payload = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

function canvasOf(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] | null {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  return ctx ? [canvas, ctx] : null;
}

/**
 * A picked file as a webp data URL at most `maxSide` on its longest side. Empty when the file is
 * not PNG or WebP, cannot be decoded, or is still over the byte limit after shrinking.
 */
export async function shrinkImage(file: File, maxSide: number): Promise<string> {
  if (!IMAGE_TYPES.includes(file.type)) return '';
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return '';
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const drawn = canvasOf(bitmap.width * scale, bitmap.height * scale);
  if (!drawn) return '';
  const [canvas, ctx] = drawn;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const image = canvas.toDataURL('image/webp', 0.9);
  return decodedBytes(image) <= IMAGE_LIMIT ? image : '';
}

/**
 * The dark-theme tone of one opaque pixel, or null when the pixel keeps its colour.
 * Neutral pixels (black, grey, white ink) are lifted into a silver range that keeps their order;
 * coloured pixels (brand reds, golds) stay as uploaded. Very dark pixels with a faint tint are
 * anti-aliased ink edges and are lifted too, so the lettering does not fringe.
 */
export function darkTone(r: number, g: number, b: number): [number, number, number] | null {
  const high = Math.max(r, g, b);
  const low = Math.min(r, g, b);
  const chroma = high - low;
  if (chroma < 0.3 * high || (high < 50 && chroma < 18)) {
    const tone = Math.min(255, Math.floor(150 + ((r + g + b) / 3) * 0.42));
    return [tone, tone, tone];
  }
  return null;
}

/**
 * Decodes a data URL through an image element. `fetch()` is not used because the page's CSP
 * `connect-src` has no `data:` entry (and should not), while `img-src` does.
 */
function decodeDataUrl(dataUrl: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = dataUrl;
  });
}

/** The dark-theme copy of a logo data URL, as a webp data URL. Empty when it cannot be drawn. */
export async function darkVariant(dataUrl: string): Promise<string> {
  const image = await decodeDataUrl(dataUrl);
  if (!image || !image.naturalWidth) return '';
  const drawn = canvasOf(image.naturalWidth, image.naturalHeight);
  if (!drawn) return '';
  const [canvas, ctx] = drawn;
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = pixels.data;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    const lifted = darkTone(data[index], data[index + 1], data[index + 2]);
    if (!lifted) continue;
    data[index] = lifted[0];
    data[index + 1] = lifted[1];
    data[index + 2] = lifted[2];
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/webp', 0.9);
}

/** Reads a stored image back as a data URL so an untouched one can be re-sent on save. */
export async function fetchAsDataUrl(url: string): Promise<string> {
  const blob = await fetch(url, { cache: 'no-store' }).then((response) => (response.ok ? response.blob() : null)).catch(() => null);
  if (!blob) return '';
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => resolve('');
    reader.readAsDataURL(blob);
  });
}
