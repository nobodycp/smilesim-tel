'use client';

import { ImageUp } from 'lucide-react';
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { cn } from '../lib/cn';
import { usePrefs } from '../lib/prefs';
import { Button } from './ui/button';
import { DataImage } from './data-image';

/**
 * One image slot on the identity page: a dashed drop area that is also a file picker, the current
 * image (or an upload glyph), and a remove button once an image is set. `value` is a data URL or
 * a same-origin URL; '' means none. `dark` is the dark-theme copy shown under `.dark`.
 *
 * Its look (Tailwind migration T4.10), ported from desk/branding.css with pane.css and base.css under it: the slot a
 * column 8px apart at the top; its title 11px semibold muted; the drop area (it sits in a pane) a grid of the
 * picture and the words 12px apart, centred, at least 96px high, 12px padding, a 1px dashed `--rd-field` edge, 8px
 * corners, `--rd-surface-2`, 13px ink 500, a pointer; under the pointer, while a file is dragged over it and while its
 * picker has the focus, the edge turns solid ink. The picture's frame: 120 × 72px (72 × 72 for the square favicon), a
 * 1px `--rd-line` edge, 6px corners, `--rd-surface`, its content centred and clipped; the picture contained within it,
 * the logo's two copies swapping with the theme (base.css `.brand-logo-light` / `-dark`); the upload glyph 22px muted.
 * The words a column 2px apart that may shrink: the action 14px bold over the hint 12px muted. The file field is a
 * 1px see-through point that takes no pointer. The remove button sits at the start, 30px high, 12px.
 */
const PICTURE = 'max-h-full max-w-full object-contain';

export function BrandingDrop({
  id,
  title,
  value,
  dark,
  square,
  onPick,
  onClear,
}: {
  id: string;
  title: string;
  value: string;
  dark?: string;
  square?: boolean;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  const { t } = usePrefs();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onPick(file);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) onPick(file);
  }

  return (
    <div className="grid content-start gap-2">
      <span className="text-xs font-semibold text-muted" id={`${id}-label`}>{title}</span>
      <label
        className={cn(
          'relative grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-3 min-h-24 rounded-card border border-dashed border-field',
          'bg-surface-2 p-3 text-md font-medium text-ink hover:border-solid hover:border-ink focus-within:border-solid focus-within:border-ink',
          over && 'border-solid border-ink',
        )}
        data-slot="branding-drop"
        data-over={over ? '' : undefined}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <span
          className={cn('grid h-18 place-items-center overflow-hidden rounded-sm border border-line bg-surface', square ? 'w-18' : 'w-30')}
          aria-hidden="true"
        >
          {value ? (
            <>
              <DataImage src={value} alt="" className={cn(PICTURE, dark && 'dark:hidden')} />
              {dark && <DataImage src={dark} alt="" className={cn(PICTURE, 'hidden dark:block')} />}
            </>
          ) : (
            <ImageUp strokeWidth={1.9} className="size-5.5 text-muted" />
          )}
        </span>
        <span className="grid min-w-0 gap-0.5">
          <strong className="text-base font-bold">{value ? t.brandingReplace : t.brandingChoose}</strong>
          <small className="text-sm text-muted">{t.brandingDrag}</small>
        </span>
        <input
          ref={input}
          type="file"
          accept="image/png,image/webp"
          className="pointer-events-none absolute size-px opacity-0"
          aria-labelledby={`${id}-label`}
          onChange={onChange}
        />
      </label>
      {value && (
        <Button type="button" variant="secondary" size="sm" className="h-7.5 justify-self-start text-sm" onClick={onClear}>
          {t.brandingRemove}
        </Button>
      )}
    </div>
  );
}
