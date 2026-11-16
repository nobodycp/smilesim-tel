import { cn } from '../lib/cn';
import { markColor, markOf } from '../lib/company-mark';
import { DataImage } from './data-image';

type MarkSize = 'sm' | 'lg';

/*
 * A company's mark (Tailwind migration T4.3, ADR 0022), ported from graphite.css `.co-mark` and `.co-mark.big`: the
 * company's picture, or its letters (`markOf`) in white (`--rd-on-mark`) on the colour taken from its name
 * (`markColor`), centred in a tile that does not shrink, with 4px corners and the tag's cut corner at the top inline
 * end. sm (`.co-mark`) is 32px with 13px bold letters and a 7px cut; lg (`.co-mark.big`) is 46px with 18px letters and
 * a 10px cut. A picture covers the tile. It is decoration: the caller names the company in text beside it. A caller's
 * `className` sizes it in its context (the company card under 641px, the settings' picture row) and comes last (`cn`).
 * `data-slot="company-mark"` is its handle.
 */
const MARK = 'grid flex-none place-items-center rounded-xs font-bold text-on-mark object-cover';

const SIZE: Record<MarkSize, string> = {
  sm: cn(
    'size-8 text-md',
    '[clip-path:polygon(0_0,calc(100%_-_7px)_0,100%_7px,100%_100%,0_100%)]',
    'rtl:[clip-path:polygon(7px_0,100%_0,100%_100%,0_100%,0_7px)]',
  ),
  lg: cn(
    'size-11.5 text-2xl',
    '[clip-path:polygon(0_0,calc(100%_-_10px)_0,100%_10px,100%_100%,0_100%)]',
    'rtl:[clip-path:polygon(10px_0,100%_0,100%_100%,0_100%,0_10px)]',
  ),
};

export function CompanyMark({ name, image, size = 'sm', className }: {
  name: string;
  image?: string | null;
  size?: MarkSize;
  className?: string;
}) {
  const classes = cn(MARK, SIZE[size], className);
  if (image) return <DataImage data-slot="company-mark" className={classes} src={image} alt="" />;
  return (
    <span data-slot="company-mark" className={classes} style={{ background: markColor(name) }} aria-hidden="true">
      {markOf(name)}
    </span>
  );
}
