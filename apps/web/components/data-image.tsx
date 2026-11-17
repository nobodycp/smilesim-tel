import type { ImgHTMLAttributes } from 'react';

/**
 * An image the API or the browser already sized: a picture route on the same origin (`/api/branding/*`, and the
 * company marks and offer pictures `/api/pictures/*`, speed plan PF.7) or a `data:` / `blob:` URL (a file being
 * picked, an eSIM QR). next/image has nothing to optimise there, so this is a plain <img>; the CSP allows `'self'`
 * and those two schemes (proxy.ts, img-src). Any other picture uses next/image instead.
 */
export function DataImage({ alt, ...props }: ImgHTMLAttributes<HTMLImageElement> & { alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- data:/blob: source, see above
  return <img alt={alt} {...props} />;
}
