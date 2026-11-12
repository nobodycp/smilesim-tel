import { request, segment, queryString } from '../../lib/http';
import type { ActivateBody, ApplyResult, DisconnectQuote, LineDetail, LineHistory, LineRow, Outcome, PosChoice, Page } from '../../lib/api-types';

/** The lines calls of the office API. Composed into `api` by lib/api.ts. */
export const linesApi = {
  officeLines: (query?: { q?: string; status?: string; packageCode?: string; provider?: string; company?: string; sim?: string; loginName?: string; cursor?: string | null }) =>
    request<Page<LineRow> & { poses: PosChoice[] }>('GET', `/office/lines${queryString(query)}`),
  officeLine: (id: string) => request<{ line: LineDetail; history: LineHistory[] }>('GET', `/office/lines/${segment(id)}`),
  activateLine: (body: ActivateBody) => request<ApplyResult>('POST', '/office/lines', body),
  extendLine: (id: string, outcome: Outcome) => request<ApplyResult>('POST', `/office/lines/${segment(id)}/extend`, { outcome }),
  reactivateLine: (id: string, outcome: Outcome) => request<ApplyResult>('POST', `/office/lines/${segment(id)}/reactivate`, { outcome }),
  chargeLine: (id: string, outcome: Outcome) => request<ApplyResult>('POST', `/office/lines/${segment(id)}/charge`, { outcome }),
  refreshLine: (id: string, outcome: Outcome) => request<ApplyResult>('POST', `/office/lines/${segment(id)}/refresh`, { outcome }),
  renameLine: (id: string, msisdn: string, outcome: Outcome) =>
    request<ApplyResult>('POST', `/office/lines/${segment(id)}/rename`, { msisdn, outcome }),
  swapSim: (id: string, sim: { iccid: string; esim?: boolean; qr?: string | null }, outcome: Outcome) =>
    request<ApplyResult>('POST', `/office/lines/${segment(id)}/sim`, { ...sim, outcome }),
  requestEsim: (id: string) => request<ApplyResult>('POST', `/office/lines/${segment(id)}/esim`),
  /** One of the package's extra operations (spec 2026-11-09, 3): always a manual task. */
  requestAddon: (id: string, addonId: string) => request<ApplyResult>('POST', `/office/lines/${segment(id)}/addon`, { addonId }),
  disconnectQuote: (id: string) => request<DisconnectQuote>('GET', `/office/lines/${segment(id)}/disconnect-quote`),
  disconnectLine: (id: string, outcome: Outcome) =>
    request<ApplyResult>('POST', `/office/lines/${segment(id)}/disconnect`, { outcome }),
  freezeLine: (id: string, outcome: Outcome) => request<ApplyResult>('POST', `/office/lines/${segment(id)}/freeze`, { outcome }),
  unfreezeLine: (id: string, outcome: Outcome) => request<ApplyResult>('POST', `/office/lines/${segment(id)}/unfreeze`, { outcome }),
  switchLine: (id: string, packageCode: string, outcome: Outcome) =>
    request<ApplyResult>('POST', `/office/lines/${segment(id)}/switch`, { packageCode, outcome }),
};
