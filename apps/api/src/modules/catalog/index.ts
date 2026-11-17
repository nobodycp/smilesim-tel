// The public surface of the catalog module (ADR 0020): what other modules may import from it. A module imports
// another through its surface only (`module-surface`, architecture-boundaries.spec.ts); the composition roots
// (`app`) and the specs may reach inside.

export { simLength, simPrefix } from './companies/companies.schemas';
export { companyMarkUrls } from './companies/company-marks';
export { SellPriceBody } from './packages/packages.schemas';
export type { Action } from './rules/actions';
export { publicPackageCode } from './rules/package-code';
export { AGOROT, chainHolds, esimPriceOf, mirroredDuration } from './rules/package-prices';
export type { PriceField, Prices } from './rules/package-prices';
export { ACTION_KEYS, activateInputs, flagsForMode, normalizeActionModes, offeredOperations, packageModeData, refreshMode, resolvePackageMode } from './rules/run-modes';
export type { ActionKey, ActionMode } from './rules/run-modes';
export { issueSerial, simRefusal, simRulesOf } from './rules/sim-rules';
export { catalog, companies, packageCode, packageName } from './shipped/shipped-catalog';
export type { CatalogPackage } from './shipped/shipped-catalog';
