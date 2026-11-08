'use client';

import { ImageUp } from 'lucide-react';
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { usePrefs } from '../lib/prefs';
import { Button } from './ui/button';

/**
 * One image slot on the identity page: a dashed drop area that is also a file picker, the current
 * image (or an upload glyph), and a remove button once an image is set. `value` is a data URL or
 * a same-origin URL; '' means none. `dark` is the dark-theme copy shown under `.dark`.
 */
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

  const dropClass = ['drop', value ? 'has-image' : '', over ? 'over' : ''].filter(Boolean).join(' ');

  return (
    <div className={square ? 'drop-field square' : 'drop-field'}>
      <span className="drop-title" id={`${id}-label`}>{title}</span>
      <label
        className={dropClass}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <span className="drop-thumb" aria-hidden="true">
          {value ? (
            <>
              <img src={value} alt="" className={dark ? 'brand-logo-light' : undefined} />
              {dark && <img src={dark} alt="" className="brand-logo-dark" />}
            </>
          ) : (
            <ImageUp strokeWidth={2.2} />
          )}
        </span>
        <span className="drop-text">
          <strong>{value ? t.brandingReplace : t.brandingChoose}</strong>
          <small>{t.brandingDrag}</small>
        </span>
        <input ref={input} type="file" accept="image/png,image/webp" aria-labelledby={`${id}-label`} onChange={onChange} />
      </label>
      {value && (
        <Button type="button" variant="secondary" size="sm" className="drop-clear" onClick={onClear}>
          {t.brandingRemove}
        </Button>
      )}
    </div>
  );
}
