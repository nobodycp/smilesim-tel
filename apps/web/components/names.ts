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

export function applyNote(t: Copy, data: { applied: boolean; debited?: boolean }): string {
  if (!data.applied) return t.sentToBranch;
  return data.debited ? t.appliedNow : t.appliedDone;
}

export function actionName(t: Copy, action: string): string {
  if (action === 'activate') return t.actActivate;
  if (action === 'charge') return t.actCharge;
  if (action === 'extend') return t.extend;
  if (action === 'reactivate') return t.actCharge;
  if (action === 'refresh') return t.updateNumber;
  if (action === 'rename') return t.changeNumber;
  if (action === 'esim') return t.actEsim;
  if (action === 'companySwitch') return t.actCompanySwitch;
  if (action === 'sim') return t.swapSim;
  if (action === 'disconnect') return t.actDisconnect;
  if (action === 'freeze') return t.actFreeze;
  if (action === 'unfreeze') return t.unfreeze;
  if (action === 'switch') return t.actSwitch;
  if (action === 'transfer') return t.transfer;
  if (action === 'enter') return t.enterAccount;
  if (action === 'fund') return t.fund;
  if (action === 'self_fund') return t.selfFund;
  if (action === 'login') return t.actLogin;
  if (action === 'logout') return t.actLogout;
  if (action === 'password') return t.actPassword;
  if (action === 'two_factor') return t.actTwoFactor;
  if (action === 'passkey_add') return t.actPasskeyAdd;
  if (action === 'passkey_remove') return t.actPasskeyRemove;
  if (action === 'user_create') return t.actUserCreate;
  if (action === 'user_freeze') return t.actUserFreeze;
  if (action === 'user_restore') return t.actUserRestore;
  if (action === 'user_delete') return t.actUserDelete;
  if (action === 'user_transfer') return t.actUserTransfer;
  if (action === 'access') return t.actAccess;
  if (action === 'leave') return t.actLeave;
  if (action === 'task_take') return t.actTaskTake;
  if (action === 'task_release') return t.actTaskRelease;
  if (action === 'task_note') return t.actTaskNote;
  if (action === 'task_complete') return t.actTaskComplete;
  if (action === 'task_reject') return t.actTaskReject;
  if (action === 'task_cancel') return t.actTaskCancel;
  if (action === 'provider_mode') return t.actProviderMode;
  if (action === 'provider_esim_price') return t.actProviderEsimPrice;
  if (action === 'company_sim') return t.actCompanySim;
  if (action === 'package_mode') return t.actPackageMode;
  if (action === 'package_price') return t.actPackagePrice;
  if (action === 'package_chain') return t.actPackageChain;
  if (action === 'package_reprice') return t.actPackageReprice;
  if (action === 'user_package') return t.actUserPackage;
  if (action === 'user_ops') return t.actUserOps;
  if (action === 'sell_price') return t.actSellPrice;
  return action;
}

export function lineStatus(t: Copy, status: string): string {
  if (status === 'active') return t.lineActive;
  if (status === 'frozen') return t.lineFrozen;
  if (status === 'disconnected') return t.lineDisconnected;
  if (status === 'suspended') return t.lineSuspended;
  return status;
}

export function taskStatus(t: Copy, status: string): string {
  if (status === 'pending') return t.pending;
  if (status === 'working') return t.working;
  if (status === 'done') return t.done;
  if (status === 'cancelled') return t.cancelled;
  return status;
}
