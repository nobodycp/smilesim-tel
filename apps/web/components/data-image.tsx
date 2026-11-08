import type { ImgHTMLAttributes } from 'react';

/**
 * An image whose `src` is a `data:` or `blob:` URL from the API or the browser (site logo, favicon, company mark, a
 * file being picked). next/image has nothing to optimise there, so this is a plain <img>; the CSP allows exactly
 * those two schemes (proxy.ts, img-src). A picture with a real URL uses next/image instead.
 */
export function DataImage({ alt, ...props }: ImgHTMLAttributes<HTMLImageElement> & { alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- data:/blob: source, see above
  return <img alt={alt} {...props} />;
}
