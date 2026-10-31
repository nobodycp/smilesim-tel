import { chargeDebit, type LineTerms } from './office-rules';

export function priced(kind: 'subscription' | 'renewal', terms: LineTerms, offer: number | null): number {
  const base = kind === 'subscription' ? terms.subscription.posPrice : chargeDebit(terms);
  return offer ?? base;
}
