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
import { Fact, Facts } from './facts';

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
      markSize="lg"
      testId="activation-result"
      footer={<Button type="button" onClick={leave}>{t.ok}</Button>}
    >
      {line ? (
        // A column 12px apart; the note under it is a plain paragraph.
        <div className="grid content-start gap-3 *:min-w-0">
          {line.esimQr ? <QrTile src={line.esimQr} /> : null}
          <Facts>
            <Fact label={t.number}><bdi dir="ltr">{line.msisdn}</bdi></Fact>
            <Fact label={t.simType}>{line.esim ? t.esim : t.physicalSim}</Fact>
            <Fact label={t.simSerial}>{line.iccid ? <bdi dir="ltr">{line.iccid}</bdi> : '—'}</Fact>
          </Facts>
          {result?.debited ? <p>{t.appliedNow}</p> : null}
        </div>
      ) : null}
    </Dialog>
  );
}
