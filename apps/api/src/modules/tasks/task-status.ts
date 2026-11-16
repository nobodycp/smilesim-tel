// The statuses a task is stored with, and the one a list filter names.

export const TASK_STATUSES = ['pending', 'working', 'done', 'cancelled'] as const;

export function taskStatusOf(value: string | undefined): (typeof TASK_STATUSES)[number] | undefined {
  return TASK_STATUSES.find((item) => item === value);
}
