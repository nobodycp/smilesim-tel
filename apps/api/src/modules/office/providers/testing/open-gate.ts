import type { SendGate } from '../dispatch/dispatch-gate';

/**
 * For specs only: a gate that lets every attempt through, for the specs that exercise the dispatcher and the
 * settlement and are not about the switch. It is under `testing/`, which the build leaves out and nothing shipped
 * imports: the worker has no way to an open gate.
 */
export const OPEN_GATE: SendGate = { permits: async () => true };
