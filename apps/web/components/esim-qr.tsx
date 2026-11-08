'use client';

// How a line's SIM shows up: a badge for its kind, a small tile with the eSIM QR picture, the dialog
// that shows that picture large enough to scan, and the file picker that takes a new one.

import { useId, useState } from 'react';
import { QrCode } from 'lucide-react';
import { QR_ACCEPT, compactQr } from '../lib/qr-image';
import { usePrefs } from '../lib/prefs';
import { Dialog } from './dialog';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Alert } from './alert';

type SimLike = { esim: boolean; esimQr: string | null };
type LineLike = SimLike & { msisdn: string; iccid: string | null };

/**
 * The kind of SIM as a badge. When the line has a QR picture and `onOpen` is given, the eSIM badge
 * itself is the button that opens it; no separate thumbnail.
 */
export function SimBadge({ line, onOpen, label }: { line: SimLike; onOpen?: () => void; label?: string }) {
  const { t } = usePrefs();
  if (!line.esim) return <Badge variant="muted">{t.physicalSim}</Badge>;
  if (!line.esimQr) return <Badge variant="warning">{t.esimNoQr}</Badge>;
  if (!onOpen) return <Badge variant="muted">eSIM</Badge>;
  return (
    <button type="button" className="esim-open" aria-label={label ?? t.showQr} title={label ?? t.showQr} onClick={onOpen}>
      <Badge variant="muted"><QrCode size={12} strokeWidth={2} aria-hidden="true" />eSIM</Badge>
    </button>
  );
}

/** The eSIM picture as a 44px tile. Clicking opens it large. */
export function EsimMark({ src, label, onOpen }: { src: string; label: string; onOpen: () => void }) {
  return (
    <button type="button" className="esim-mark" aria-label={label} title={label} onClick={onOpen}>
      {/* A data URL the browser already holds; next/image has nothing to optimise. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" />
    </button>
  );
}

/** The QR picture large, with the number and the serial under it. Open while `line` has a picture. */
export function EsimDialog({ line, onClose }: { line: LineLike | null; onClose: () => void }) {
  const { t } = usePrefs();
  return (
    <Dialog open={Boolean(line?.esimQr)} title={t.esimQr} closeLabel={t.closeMenu} onClose={onClose} size="confirm" footer={<Button type="button" variant="secondary" onClick={onClose}>{t.closeMenu}</Button>}>
      {line?.esimQr ? (
        <div className="stack">
          <QrTile src={line.esimQr} />
          <dl className="detail-rows">
            <div><dt>{t.number}</dt><dd><bdi dir="ltr">{line.msisdn}</bdi></dd></div>
            <div><dt>{t.simSerial}</dt><dd>{line.iccid ? <bdi dir="ltr">{line.iccid}</bdi> : '—'}</dd></div>
          </dl>
        </div>
      ) : null}
    </Dialog>
  );
}

export function QrTile({ src }: { src: string }) {
  return (
    <div className="qr-tile">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" />
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
    <div className="qr-picker">
      {value ? <QrTile src={value} /> : null}
      <div className="qr-picker-row">
        <label className="quiet-file" htmlFor={id}>
          {value ? t.changeQr : t.pickQr}
          <input
            id={id}
            type="file"
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
