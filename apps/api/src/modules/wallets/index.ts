// The public surface of the wallets module (ADR 0020): what other modules may import from it. A module imports
// another through its surface only (`module-surface`, architecture-boundaries.spec.ts); the composition roots
// (`app`) and the specs may reach inside.

export { PROVIDER_OPERATION_KINDS } from './provider-cost';
export { csvOf } from './report-csv';
export { saleOf } from './sale';
export { marginViewOf, saleOrRefundWhere } from './stored-margins';
export type { MarginView } from './stored-margins';
export type { Sale } from './sale';
export { WalletLedger } from './wallet-ledger';
export { WalletsModule } from './wallets.module';
export { CursorQuery, ceilingValue } from './wallets.schemas';
export { WalletsService } from './wallets.service';
