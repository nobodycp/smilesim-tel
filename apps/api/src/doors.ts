import type { Layer } from './modules/auth/decide-login';

export const DOOR_HOSTS = [
  { host: 'admin', layer: 'branch' },
  { host: 'main', layer: 'main_agent' },
  { host: 'agent', layer: 'agent' },
  { host: 'pos', layer: 'pos' },
] as const satisfies readonly { host: string; layer: Layer }[];

export function doorHostOf(hostname: string): (typeof DOOR_HOSTS)[number] | null {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host === '127.0.0.1') return null;
  const label = host.endsWith('.localhost') ? host.slice(0, -'.localhost'.length) : host.split('.')[0];
  return DOOR_HOSTS.find((door) => door.host === label) ?? null;
}

/** The door is taken from the host label. Origin and the header must agree when both are present. */
export function expectedLayer(input: { origin?: string; door?: string }): Layer | 'conflict' | null {
  const fromHeader = DOOR_HOSTS.find((door) => door.host === input.door)?.layer ?? null;
  let fromOrigin: Layer | null = null;
  if (input.origin) {
    try {
      fromOrigin = doorHostOf(new URL(input.origin).hostname)?.layer ?? null;
    } catch {
      fromOrigin = null;
    }
  }
  if (fromHeader && fromOrigin && fromHeader !== fromOrigin) return 'conflict';
  return fromHeader ?? fromOrigin;
}
