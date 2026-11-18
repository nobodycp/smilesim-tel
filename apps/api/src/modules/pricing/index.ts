// The public surface of the pricing module (ADR 0020): what other modules may import from it. A module imports
// another through its surface only (`module-surface`, architecture-boundaries.spec.ts); the composition roots
// (`app`) and the specs may reach inside.

export { lineTermsOf } from './line-terms';
export { PRICE_COLUMNS, PriceLadder } from './price-ladder';
export { RENEWABLE_STATUSES } from './rules/line-prices';
export { packageTermsOf } from './rules/package-terms';
export type { PackagePriceRow } from './rules/package-terms';
export { DISCONNECT_FEE, activationProviderCost, captureTerms, costsAtProvider, heldEsimFee, packageActivationCost, providerBranchCost } from './rules/prices';
export type { LineTerms, PackageTerms } from './rules/prices';
export { REFUND_KINDS, SALE_KINDS, ladderOf, marginOf, refundLadder } from './rules/profit-ladder';
export type { Ladder } from './rules/profit-ladder';
export { buyPriceFor, deniedOpsFor, floorFor, isOpKey, parseOps, serializeOps, visibleTo } from './rules/user-terms';
export type { LayerPrices, OpKey, PriceKind, SellRow, TermRow } from './rules/user-terms';
export { TermsModule } from './terms.module';
export { TermsService } from './terms.service';
