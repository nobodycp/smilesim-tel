import { z } from 'zod';
import { agorot } from '../../shared/schemas';
import { OP_KEYS } from '../rules/user-terms';

/** A price of its own: agorot to set it, null to clear it, absent to leave it as it is. */
const price = agorot.nullable().optional();

const packageCode = z.string().min(1).max(64);

/** One package for one account: hide or show it, price it. A body that sets nothing is refused by the service. */
export const UserPackageBody = z.object({ hidden: z.boolean().optional(), price, renewalPrice: price });
export type UserPackageBody = z.input<typeof UserPackageBody>;

export const CustomPriceBody = z.object({ price, renewalPrice: price });
export type CustomPriceBody = z.input<typeof CustomPriceBody>;

export const UserPackagesBulkBody = z.object({ codes: z.array(packageCode).max(2000), hidden: z.boolean() });
export type UserPackagesBulkBody = z.input<typeof UserPackagesBulkBody>;

export const UserOpsBody = z.object({ denied: z.array(z.enum(OP_KEYS)).max(64) });
export type UserOpsBody = z.input<typeof UserOpsBody>;

/** Every number carrying `from` takes `to`: a flat price, or what a new activation would carry now. */
const priceGroup = z.object({ from: agorot, to: z.union([z.literal('current'), agorot]) });

/**
 * `scope` is an account login or `all`. It may be absent here: the service refuses a caller with no say over
 * line prices (403) before it refuses a missing scope (400).
 */
export const LinePricesBody = z.object({ scope: z.string().max(64).optional(), groups: z.array(priceGroup).max(1000) });
export type LinePricesBody = z.input<typeof LinePricesBody>;
