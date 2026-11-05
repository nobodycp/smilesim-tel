// A QR picture the provider handed the branch, shrunk into a data URL the API stores on the line.
// Unlike a logo, a QR must keep hard edges, so a png stays png and nothing is blurred by lossy compression.

const QR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const QR_SIDE = 640;
const QR_LIMIT = 300_000;

export const QR_ACCEPT = QR_TYPES.join(',');

/** Empty when the file is not png/jpeg/webp, cannot be decoded, or is still over 300 KB after shrinking. */
export async function compactQr(file: File): Promise<string> {
  if (!QR_TYPES.includes(file.type)) return '';
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return '';
  const scale = Math.min(1, QR_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.imageSmoothingEnabled = scale === 1;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const png = canvas.toDataURL('image/png');
  if (png.length <= QR_LIMIT) return png;
  const webp = canvas.toDataURL('image/webp', 0.92);
  return webp.length <= QR_LIMIT ? webp : '';
}
