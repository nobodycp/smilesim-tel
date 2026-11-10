import { z } from 'zod';
import { id, optionalText, providerHint, queryCursor, queryOneOf, queryText } from '../../shared/schemas';
import { LINE_STATUSES } from '../rules/office-paging';

// The bodies of the line routes (backend-engineering.mdc 4.1). A field whose malformed value has its own
// refusal stays wide here and is judged by the service: a SIM serial (`SIM_*`), a QR picture (`QR_INVALID`).

/** The simulated provider's answer. A bare `z.unknown()` key must be present in zod 4, and a body may leave this out. */
const outcome = providerHint;

/** A mobile number that may be left out: empty, or a number as the office writes it. */
const optionalMsisdn = z.string().trim().regex(/^(05\d{8})?$/).optional().default('');

/** A SIM serial as typed, or nothing. The company's rules answer `SIM_DIGITS`, `SIM_LENGTH`, `SIM_PREFIX`. */
const simSerial = optionalText(64);

/** A catalog code or a login as it is stored: not trimmed, so one with spaces around it is still not found. */
const stored = z.string().min(1).max(64);

/** A text the branch reads on a task: the details of a manual activation, the note that closes a task. */
export const TASK_TEXT_MAX = 2000;

/** A QR picture. `readQr` (line-input.ts) checks its type and size and answers `QR_INVALID`. */
const qr = z.unknown().optional().describe('QR picture as a data URL (png, jpeg, webp), or null');

export const ActivateBody = z.object({
  packageCode: stored,
  posLoginName: stored,
  esim: z.boolean().optional().default(false),
  iccid: simSerial,
  msisdn: optionalMsisdn,
  currentDetails: optionalText(TASK_TEXT_MAX),
  outcome,
});
export type ActivateBody = z.input<typeof ActivateBody>;

/** An operation that takes nothing but the simulated provider's answer. */
export const OutcomeBody = z.object({ outcome });
export type OutcomeBody = z.input<typeof OutcomeBody>;

export const SwitchPackageBody = z.object({ packageCode: stored, outcome });
export type SwitchPackageBody = z.input<typeof SwitchPackageBody>;

/** `targetCode` left out renews the package the number is on. */
export const ExtendBody = z.object({ targetCode: z.string().max(64).optional().default(''), outcome });
export type ExtendBody = z.input<typeof ExtendBody>;

/** The new number may be left out: the branch then takes it when it closes the task. */
export const RenameLineBody = z.object({ msisdn: optionalMsisdn, outcome });
export type RenameLineBody = z.input<typeof RenameLineBody>;

export const SwapSimBody = z.object({
  iccid: simSerial,
  esim: z.boolean().optional().default(false),
  qr,
  outcome,
});
export type SwapSimBody = z.input<typeof SwapSimBody>;

export const AddonBody = z.object({ addonId: id });
export type AddonBody = z.input<typeof AddonBody>;

/** What the branch hands back when it closes a task: an eSIM's serial and QR, or the new number of a rename. */
export const CompleteTaskBody = z.object({
  note: optionalText(TASK_TEXT_MAX),
  iccid: simSerial,
  qr,
  // Read only by a number change, which refuses anything but a mobile number.
  msisdn: optionalText(32),
});
export type CompleteTaskBody = z.input<typeof CompleteTaskBody>;

/** GET lines — the filters of the numbers list. `expiring` is not a stored status: it reads the end date. */
export const LinesQuery = z.object({
  cursor: queryCursor,
  q: queryText(),
  status: queryOneOf([...LINE_STATUSES, 'expiring']),
  packageCode: queryText(),
  provider: queryText(),
  company: queryText(),
  /** One account's numbers: its own, or every point of sale below it. */
  loginName: queryText(),
});
export type LinesQuery = z.input<typeof LinesQuery>;
