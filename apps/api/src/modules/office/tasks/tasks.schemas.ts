import { z } from 'zod';

/** The longest note or refusal reason written on a task. */
export const TASK_NOTE_MAX = 2000;

/** An inspection note. `internal` is the branch's own note, which only the branch may write and read. */
export const TaskNoteBody = z.object({
  text: z.string().trim().min(1).max(TASK_NOTE_MAX),
  internal: z.boolean().optional().default(false),
});
export type TaskNoteBody = z.input<typeof TaskNoteBody>;

export const TaskRejectBody = z.object({ reason: z.string().trim().min(1).max(TASK_NOTE_MAX) });
export type TaskRejectBody = z.input<typeof TaskRejectBody>;
