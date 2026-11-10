// The few sentences the API itself writes into the database and the web shows as written (backend-engineering.mdc
// 5.9). They live here and nowhere else; `architecture.spec.ts` refuses a stored sentence in any other file.
// A new one belongs here only if it cannot be a code the web translates.

/** A task opened because the operation runs through the branch by hand. */
export const BRANCH_TASK_NOTE = 'مهمة فرع';

/** Written in a task's log when its handler's account is frozen and the task goes back to the pool. */
export const HANDLER_FROZEN_NOTE = 'رجعت لأن الحساب أُوقف';

/** The note a task carries when the provider refused the operation; provider health counts these. */
export const PROVIDER_FAILED_NOTE = 'فشل المزود';

/** Who a notice comes from when no person sent it. */
export const SYSTEM_SENDER_NAME = 'النظام';
