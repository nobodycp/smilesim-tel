import { request, segment, queryString } from '../../lib/http';
import type { CompleteTaskBody, DecisionView, ProviderDecisionAnswer, ProviderDecisionApprovalAnswer, ProviderDecisionBody, TaskDetail, TaskEvent, TaskRow, Page, WaitingDecision } from '../../lib/api-types';

/** The tasks calls of the office API. Composed into `api` by lib/api.ts. */
export const tasksApi = {
  tasks: (query?: {
    q?: string;
    status?: string;
    action?: string;
    packageCode?: string;
    company?: string;
    provider?: string;
    cursor?: string | null;
  }) => request<Page<TaskRow>>('GET', `/v1/tasks${queryString(query)}`),
  task: (id: string) => request<{ task: TaskDetail; events: TaskEvent[] }>('GET', `/v1/tasks/${segment(id)}`),
  addTaskNote: (id: string, text: string, internal = false) => request<{ ok: true }>('POST', `/v1/tasks/${segment(id)}/notes`, { text, ...(internal ? { internal: true } : {}) }),
  takeTask: (id: string) => request<{ ok: true }>('POST', `/v1/tasks/${segment(id)}/take`),
  releaseTask: (id: string) => request<{ ok: true }>('POST', `/v1/tasks/${segment(id)}/release`),
  completeTask: (id: string, body: CompleteTaskBody) => request<{ ok: true }>('POST', `/v1/tasks/${segment(id)}/complete`, body),
  rejectTask: (id: string, reason: string) => request<{ ok: true }>('POST', `/v1/tasks/${segment(id)}/reject`, { reason }),
  cancelTask: (id: string) => request<{ ok: true }>('POST', `/v1/tasks/${segment(id)}/cancel`),
  // Decisions by people on a task's provider operation (ADR 0019, D15). The body may carry an eSIM code: it goes
  // in the request and nowhere else.
  providerDecisionView: (id: string) => request<DecisionView>('GET', `/v1/tasks/${segment(id)}/provider-decision`),
  // The queue, a page at a time (`Page`), with how many wait in all for a second approval and for a first decision.
  providerDecisions: (query?: { waiting?: string; cursor?: string | null }) =>
    request<Page<WaitingDecision> & { totals: { approval: number; decision: number } }>('GET', `/v1/provider-decisions${queryString(query)}`),
  decideProviderOperation: (id: string, body: ProviderDecisionBody) => request<ProviderDecisionAnswer>('POST', `/v1/tasks/${segment(id)}/provider-decision`, body),
  answerProviderDecision: (id: string, approve: boolean) => request<ProviderDecisionApprovalAnswer>('POST', `/v1/tasks/${segment(id)}/provider-decision/approval`, { approve }),
};
