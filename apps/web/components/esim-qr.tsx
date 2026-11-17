'use client';

// How a line's SIM shows up: a badge for its kind, a small tile with the eSIM QR picture, the dialog
// that shows that picture large enough to scan, and the file picker that takes a new one.

import { useId, useState } from 'react';
import { QrCode } from 'lucide-react';
import { cn } from '../lib/cn';
import { QR_ACCEPT, compactQr } from '../lib/qr-image';
import { usePrefs } from '../lib/prefs';
import { Dialog } from './dialog';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Alert } from './alert';
import { DataImage } from './data-image';
import { Fact, Facts } from './facts';

/*
 * The look (ADR 0022):
 * - the eSIM badge as a button: the badge is the visible part, the button is at least 44px high and pulled 10px into
 *   the row above and below, with no padding, border or fill; it lifts 1px under the pointer (fast); while the line's
 *   code is being asked for it is held at 55% with a waiting pointer and no lift; a 2px `--rd-focus` outline 2px out
 *   with pill corners on keyboard focus;
 * - the eSIM tile: 44px, 4px padding, a 1px `--rd-line` border with 6px corners on `--rd-qr-tile`; it lifts 1px with a
 *   small shadow under the pointer (fast); the picture fills it, contained;
 * - the QR tile: the picture on `--rd-qr-tile` in a 1px `--rd-line` border with 8px corners, centred, at most 280px
 *   with 12px padding (`plain`); in the code dialog at most 240px with 14px padding and a small shadow (`scan`); in
 *   the picker at most 160px with 8px padding at the reading start (`thumb`); the picture full width, pixelated;
 * - the code dialog's sheet: the tile over the facts, 12px apart;
 * - the picker: a column 8px apart at the reading start; its row wraps, 8px apart; the file label is a pill at least
 *   44px high with 14px sides and a 1px `--rd-line` border, 13px ink bold, the file input stretched invisibly over it.
 *   Inside a dialog's body it takes the dialog label's 11px bold `--rd-muted` (and its grid); inside a pane the pane
 *   label's 11px `--rd-muted` 600.
 */
const ESIM_OPEN = cn(
  'inline-flex min-h-11 cursor-pointer items-center -my-2.5 border-0 bg-transparent p-0',
  'transition-transform duration-fast ease-standard hover:not-aria-busy:[transform:translateY(-1px)]',
  'aria-busy:cursor-progress aria-busy:opacity-55',
  'focus-visible:rounded-pill focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
);
const ESIM_MARK = cn(
  'inline-grid size-11 flex-none cursor-pointer place-items-center rounded-sm border border-line bg-qr-tile p-1',
  'transition-[transform,box-shadow] duration-fast ease-standard hover:shadow-sm hover:[transform:translateY(-1px)]',
);
type QrTileLook = 'plain' | 'scan' | 'thumb';
const QR_TILE: Record<QrTileLook, string> = {
  plain: 'mx-auto w-[min(100%,280px)] p-3',
  scan: 'mx-auto w-[min(100%,240px)] p-3.5 shadow-sm',
  thumb: 'mx-0 w-[min(100%,160px)] p-2',
};
const FILE_LABEL = cn(
  'relative m-0 inline-flex min-h-11 cursor-pointer items-center rounded-pill border border-line px-3.5 text-md font-bold text-ink',
  '[[data-slot=dialog-body]_&]:grid [[data-slot=dialog-body]_&]:text-xs [[data-slot=dialog-body]_&]:text-muted',
  '[:is(.pane,[data-slot=pane])_&]:text-xs [:is(.pane,[data-slot=pane])_&]:font-semibold [:is(.pane,[data-slot=pane])_&]:text-muted',
);

/** `esimQr` left out: the code is not known here (a row of a list, which does not carry it). */
type SimLike = { esim: boolean; esimQr?: string | null };
type LineLike = { esim: boolean; esimQr: string | null; msisdn: string; iccid: string | null };

/**
 * The kind of SIM as a badge. With `onOpen`, the eSIM badge itself is the button that opens the QR picture; no
 * separate thumbnail. A line known to have no picture says so. When the code is not known (a list row), the
 * button is offered for every eSIM and the caller asks for the code when it is pressed; `busy` holds it while
 * that request is out.
 */
export function SimBadge({ line, onOpen, label, busy = false }: { line: SimLike; onOpen?: () => void; label?: string; busy?: boolean }) {
  const { t } = usePrefs();
  if (!line.esim) return <Badge variant="muted">{t.physicalSim}</Badge>;
  if (line.esimQr === null || line.esimQr === '') return <Badge variant="warning">{t.esimNoQr}</Badge>;
  if (!onOpen) return <Badge variant="muted">eSIM</Badge>;
  return (
    <button type="button" className={ESIM_OPEN} aria-label={label ?? t.showQr} title={label ?? t.showQr} aria-busy={busy || undefined} disabled={busy} onClick={onOpen}>
      <Badge variant="muted"><QrCode size={12} strokeWidth={2} aria-hidden="true" />eSIM</Badge>
    </button>
  );
}

/** The eSIM picture as a 44px tile. Clicking opens it large. */
export function EsimMark({ src, label, onOpen }: { src: string; label: string; onOpen: () => void }) {
  return (
    <button type="button" className={ESIM_MARK} data-testid="esim-mark" aria-label={label} title={label} onClick={onOpen}>
      <DataImage className="block size-full object-contain" src={src} alt="" />
    </button>
  );
}

/** The QR picture large, with the number and the serial under it. Open while `line` has a picture. */
export function EsimDialog({ line, onClose }: { line: LineLike | null; onClose: () => void }) {
  const { t } = usePrefs();
  return (
    <Dialog open={Boolean(line?.esimQr)} title={t.esimQr} lede={t.esimQrLede} closeLabel={t.closeMenu} onClose={onClose} size="confirm" testId="esim-dialog" footer={<Button type="button" variant="secondary" onClick={onClose}>{t.closeMenu}</Button>}>
      {line?.esimQr ? (
        <div className="grid gap-3">
          <QrTile src={line.esimQr} look="scan" />
          <Facts>
            <Fact label={t.number}><bdi dir="ltr">{line.msisdn}</bdi></Fact>
            <Fact label={t.simSerial}>{line.iccid ? <bdi dir="ltr">{line.iccid}</bdi> : '—'}</Fact>
          </Facts>
        </div>
      ) : null}
    </Dialog>
  );
}

/** The QR picture on its light tile; `look` is where it sits (see above). */
export function QrTile({ src, look = 'plain' }: { src: string; look?: QrTileLook }) {
  return (
    <div className={cn('grid place-items-center rounded-card border border-line bg-qr-tile', QR_TILE[look])} data-testid="qr-tile">
      <DataImage className="block h-auto w-full [image-rendering:pixelated]" src={src} alt="" />
    </div>
  );
}

/**
 * Picks a QR picture and hands back its data URL, or '' when cleared. Shows the current picture
 * when there is one. The parent owns the value so it can send it with the rest of its form.
 */
export function QrPicker({ value, onChange, disabled = false }: { value: string; onChange: (dataUrl: string) => void; disabled?: boolean }) {
  const { t } = usePrefs();
  const id = useId();
  const [problem, setProblem] = useState('');
  return (
    <div className="grid justify-items-start gap-2">
      {value ? <QrTile src={value} look="thumb" /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <label className={FILE_LABEL} htmlFor={id}>
          {value ? t.changeQr : t.pickQr}
          <input
            id={id}
            type="file"
            className="absolute inset-0 size-full cursor-pointer opacity-0"
            accept={QR_ACCEPT}
            disabled={disabled}
            onChange={async (event) => {
              const picked = event.target.files?.[0];
              event.target.value = '';
              if (!picked) return;
              const image = await compactQr(picked);
              setProblem(image ? '' : t.qrTooLarge);
              if (image) onChange(image);
            }}
          />
        </label>
        {value ? (
          <Button type="button" variant="secondary" disabled={disabled} onClick={() => { onChange(''); setProblem(''); }}>
            {t.clearFilters}
          </Button>
        ) : null}
      </div>
      <Alert>{problem}</Alert>
    </div>
  );
}
