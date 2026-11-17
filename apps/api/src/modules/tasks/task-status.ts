// The statuses a task is stored with, and the one a list filter names.

export const TASK_STATUSES = ['working', 'done', 'cancelled'] as const;

export function taskStatusOf(value: string | undefined): (typeof TASK_STATUSES)[number] | undefined {
  return TASK_STATUSES.find((item) => item === value);
}

/**
 * The statuses a stored row may hold today (the `OfficeTask_status_known` CHECK): `pending` was retired on
 * 2026-11-09, and `rejected` is only on rows written before a reject closed a task as `cancelled`.
 */
export const STORED_TASK_STATUSES = ['working', 'done', 'rejected', 'cancelled'] as const;

export type TaskCounts = Record<(typeof STORED_TASK_STATUSES)[number], number>;

/** GET /v1/tasks/counts: one number per stored status, 0 for a status with no row, from one grouped count. */
export function taskCountsOf(groups: { status: string; count: number }[]): TaskCounts {
  const byStatus = new Map(groups.map((group) => [group.status, group.count]));
  return Object.fromEntries(STORED_TASK_STATUSES.map((status) => [status, byStatus.get(status) ?? 0])) as TaskCounts;
}
