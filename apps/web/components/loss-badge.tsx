'use client';

import { Badge } from './ui/badge';
import type { ProviderLoss } from '../lib/api';
import { usePrefs } from '../lib/prefs';

/**
 * The mark of an operation the provider was paid for while the point of sale was charged nothing (spec DB.5 P.7):
 * the branch's loss, labelled with why (the money given back after the provider's success, or a sale at 0), with a
 * title saying what the office looks at. A danger badge with its label, never colour alone. Nothing for no mark.
 * A given-back operation the branch charged later (spec DB.5 P.9) reads «خُصم لاحقاً» on a neutral badge.
 * The API sends the mark to the branch only.
 */
export function LossBadge({ loss }: { loss: ProviderLoss | null | undefined }) {
  const { t } = usePrefs();
  if (!loss) return null;
  // Charged to the point of sale later (P.9): no longer a loss, so the neutral badge.
  if (loss === 'charged_later') {
    return (
      <Badge variant="muted" dot title={t.lossChargedLaterTitle} data-testid="loss-badge">
        {t.lossChargedLater}
      </Badge>
    );
  }
  const givenBack = loss === 'given_back';
  return (
    <Badge variant="danger" dot title={givenBack ? t.lossGivenBackTitle : t.lossPricedZeroTitle} data-testid="loss-badge">
      {givenBack ? t.lossGivenBack : t.lossPricedZero}
    </Badge>
  );
}
