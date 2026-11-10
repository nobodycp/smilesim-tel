import { request, segment, queryString } from '../../lib/http';
import type { TransferAccountBody, TransferLinePrices, TransferPreview } from '../../lib/api-types';

/** The transfers calls of the office API. Composed into `api` by lib/api.ts. */
export const transfersApi = {
  transferAccount: (loginName: string, body: TransferAccountBody) =>
    request<{ ok: true; lines: number }>('POST', `/office/users/${segment(loginName)}/transfer`, body),
  transferPreview: (loginName: string, parentLoginName: string) =>
    request<TransferPreview>('GET', `/office/users/${segment(loginName)}/transfer-preview${queryString({ parentLoginName })}`),
  transferLine: (id: string, posLoginName: string, linePrices: TransferLinePrices) =>
    request<{ ok: true }>('POST', `/office/lines/${segment(id)}/transfer`, { posLoginName, linePrices }),
};
