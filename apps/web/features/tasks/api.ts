import { request, segment, queryString } from '../../lib/http';
import type { CompleteTaskBody, TaskDetail, TaskEvent, TaskRow } from '../../lib/api-types';

/** The tasks calls of the office API. Composed into `api` by lib/api.ts. */
export const tasksApi = {
  officeTasks: (query?: {
    q?: string;
    status?: string;
    action?: string;
    packageCode?: string;
    company?: string;
    provider?: string;
    cursor?: string | null;
  }) => request<{ tasks: TaskRow[]; nextCursor: string | null; total: number }>('GET', `/office/tasks${queryString(query)}`),
  officeTask: (id: string) => request<{ task: TaskDetail; events: TaskEvent[] }>('GET', `/office/tasks/${segment(id)}`),
  addTaskNote: (id: string, text: string, internal = false) => request<{ ok: true }>('POST', `/office/tasks/${segment(id)}/notes`, { text, ...(internal ? { internal: true } : {}) }),
  takeTask: (id: string) => request<{ ok: true }>('POST', `/office/tasks/${segment(id)}/take`),
  releaseTask: (id: string) => request<{ ok: true }>('POST', `/office/tasks/${segment(id)}/release`),
  completeTask: (id: string, body: CompleteTaskBody) => request<{ ok: true }>('POST', `/office/tasks/${segment(id)}/complete`, body),
  rejectTask: (id: string, reason: string) => request<{ ok: true }>('POST', `/office/tasks/${segment(id)}/reject`, { reason }),
  cancelTask: (id: string) => request<{ ok: true }>('POST', `/office/tasks/${segment(id)}/cancel`),
};
