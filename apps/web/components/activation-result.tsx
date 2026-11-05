'use client';

// What the seller sees once an activation went through: a check mark, the number, the serial, and
// the eSIM QR when the provider issued one. One button, and it leads home. When the activation
// became a branch task, the same dialog says so and still leads home.

import { useRouter } from 'next/navigation';
import { Dialog } from './dialog';
import { QrTile } from './esim-qr';
import { Button } from './ui/button';
import type { ApplyResult } from '../lib/api';
import { usePrefs } from '../lib/prefs';

export function ActivationResult({ result, onClose }: { result: ApplyResult | null; onClose: () => void }) {
  const { t } = usePrefs();
  const router = useRouter();
  const leave = () => {
    onClose();
    router.push('/');
  };
  const line = result?.line ?? null;
  const applied = Boolean(result?.applied);
  return (
    <Dialog
      open={Boolean(result)}
      title={applied ? t.activated : t.activationSent}
      lede={applied ? t.activatedLede : t.activationSentLede}
      closeLabel={t.ok}
      onClose={leave}
      size="confirm"
      mark={applied ? 'check' : 'plus'}
      tone={applied ? 'success' : 'neutral'}
      className="dialog-result"
      footer={<Button type="button" onClick={leave}>{t.ok}</Button>}
    >
      {line ? (
        <div className="stack">
          {line.esimQr ? <QrTile src={line.esimQr} /> : null}
          <dl className="detail-rows">
            <div><dt>{t.number}</dt><dd><bdi dir="ltr">{line.msisdn}</bdi></dd></div>
            <div><dt>{t.simType}</dt><dd>{line.esim ? t.esim : t.physicalSim}</dd></div>
            <div><dt>{t.simSerial}</dt><dd>{line.iccid ? <bdi dir="ltr">{line.iccid}</bdi> : '—'}</dd></div>
          </dl>
          {result?.debited ? <p className="hint">{t.appliedNow}</p> : null}
        </div>
      ) : null}
    </Dialog>
  );
}
