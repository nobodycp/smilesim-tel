import type { SendGate } from '../dispatch/dispatch-gate';
import type { ProviderGateway } from '../gateway/provider-gateway';

/**
 * For specs only: a gate that lets every attempt through and sends through the given gateway, for the specs that
 * exercise the dispatcher and the settlement and are not about the switch. It is under `testing/`, which the
 * build leaves out and nothing shipped imports: the worker has no way to an open gate.
 */
export function openGate(gateway: Pick<ProviderGateway, 'send'>): SendGate {
  return { permits: async () => ({ send: (operation) => gateway.send(operation) }) };
}
