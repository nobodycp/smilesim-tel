import type { Copy } from '../lib/copy';

// The words the office shows for the codes the API sends. `desk.tsx` re-exports them for the pages.

export function layerName(t: Copy, layer: string): string {
  if (layer === 'branch') return t.layerBranch;
  if (layer === 'main_agent') return t.layerMain;
  if (layer === 'agent') return t.layerAgent;
  if (layer === 'pos') return t.layerPos;
  if (layer === 'staff') return t.staffAccount;
  return layer;
}

export function actionName(t: Copy, action: string): string {
  if (action === 'activate') return t.actActivate;
  if (action === 'charge') return t.actCharge;
  if (action === 'extend') return t.extend;
  if (action === 'reactivate') return t.actActivate;
  if (action === 'rename') return t.updateNumber;
  if (action === 'sim') return t.swapSim;
  if (action === 'disconnect') return t.actDisconnect;
  if (action === 'freeze') return t.actFreeze;
  if (action === 'unfreeze') return t.unfreeze;
  if (action === 'switch') return t.actSwitch;
  if (action === 'enter') return t.enterAccount;
  if (action === 'fund') return t.fund;
  if (action === 'self_fund') return t.selfFund;
  return action;
}

export function lineStatus(t: Copy, status: string): string {
  if (status === 'active') return t.lineActive;
  if (status === 'frozen') return t.lineFrozen;
  if (status === 'disconnected') return t.lineDisconnected;
  return status;
}

export function taskStatus(t: Copy, status: string): string {
  if (status === 'pending') return t.pending;
  if (status === 'working') return t.working;
  if (status === 'done') return t.done;
  if (status === 'cancelled') return t.cancelled;
  return status;
}
