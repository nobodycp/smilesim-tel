export const DOOR_HOSTS = [
  { host: 'admin', layer: 'branch', label: 'doorBranch' },
  { host: 'main', layer: 'main_agent', label: 'doorMain' },
  { host: 'agent', layer: 'agent', label: 'doorAgent' },
  { host: 'pos', layer: 'pos', label: 'doorPos' },
] as const;

export type Door = (typeof DOOR_HOSTS)[number];

export function doorFromHost(hostHeader: string): Door | null {
  const hostname = hostHeader.split(':')[0].toLowerCase().replace(/\.$/, '');
  if (hostname === 'localhost' || hostname === '127.0.0.1') return null;
  const label = hostname.endsWith('.localhost') ? hostname.slice(0, -'.localhost'.length) : hostname.split('.')[0];
  return DOOR_HOSTS.find((door) => door.host === label) ?? null;
}

export function doorOrigin(door: Door, hostHeader: string): string {
  const port = hostHeader.includes(':') ? `:${hostHeader.split(':')[1]}` : '';
  const hostname = hostHeader.split(':')[0].toLowerCase();
  const parent = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost')
    ? 'localhost'
    : hostname.split('.').slice(1).join('.') || 'localhost';
  return `${door.host}.${parent}${port}`;
}

/** The address of `path` on another door of this office, from the page that is open now (browser only). */
export function doorUrl(host: string, path: string): string {
  const door = DOOR_HOSTS.find((item) => item.host === host) ?? DOOR_HOSTS[0];
  return `${window.location.protocol}//${doorOrigin(door, window.location.host)}${path}`;
}
