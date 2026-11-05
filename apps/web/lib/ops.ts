import type { Copy } from './copy/ar';

/** Line operations a parent can stop per account. Order is display order. */
export const OP_KEYS = ['activate', 'charge', 'extend', 'switch', 'sim', 'esim', 'freeze', 'disconnect', 'rename'] as const;
export type OpKey = (typeof OP_KEYS)[number];

export function opLabel(t: Copy, key: OpKey): string {
  switch (key) {
    case 'activate': return t.actActivate;
    case 'charge': return t.actCharge;
    case 'extend': return t.extend;
    case 'switch': return t.actSwitch;
    case 'sim': return t.swapSim;
    case 'esim': return t.requestEsim;
    case 'freeze': return t.freeze;
    case 'disconnect': return t.actDisconnect;
    case 'rename': return t.changeNumber;
  }
}

export function opDescription(t: Copy, key: OpKey): string {
  switch (key) {
    case 'activate': return t.opDescActivate;
    case 'charge': return t.opDescCharge;
    case 'extend': return t.opDescExtend;
    case 'switch': return t.opDescSwitch;
    case 'sim': return t.opDescSim;
    case 'esim': return t.opDescEsim;
    case 'freeze': return t.opDescFreeze;
    case 'disconnect': return t.opDescDisconnect;
    case 'rename': return t.opDescRename;
  }
}
