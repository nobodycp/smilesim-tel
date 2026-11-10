// The terms a line carries (its prices and renewal targets), read back from the JSON column. Shared by the
// line operations and the terms module.

import { captureTerms, type LineTerms, type Prices } from '../rules/office-rules';
import { packageTermsOf, type PackagePriceRow } from '../rules/office-terms';
export function lineTermsOf(value: unknown, pkg: PackagePriceRow): LineTerms {
  if (value === null) return captureTerms(packageTermsOf(pkg), []);
  if (!isLineTerms(value)) throw new Error(`Invalid saved terms for package ${pkg.code}`);
  return value;
}

function isLineTerms(value: unknown): value is LineTerms {
  if (!isRecord(value)) return false;
  return (
    typeof value.packageCode === 'string' &&
    isPositiveInteger(value.months) &&
    (value.windowMonths === undefined || isPositiveInteger(value.windowMonths)) &&
    isPrices(value.subscription) &&
    isPrices(value.renewal) &&
    Array.isArray(value.renewalTargets) &&
    value.renewalTargets.every(
      (target) =>
        isRecord(target) &&
        typeof target.code === 'string' &&
        isPositiveInteger(target.months) &&
        isPrices(target.renewal),
    )
  );
}

function isPrices(value: unknown): value is Prices {
  if (!isRecord(value)) return false;
  return ['branchCost', 'mainPrice', 'agentPrice', 'posPrice', 'subscriberPrice'].every(
    (field) => typeof value[field] === 'number' && Number.isInteger(value[field]) && value[field] >= 0,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
