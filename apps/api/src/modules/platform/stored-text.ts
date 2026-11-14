// The few sentences the API itself writes into the database and the web shows as written (backend-engineering.mdc
// 5.9). They live here and nowhere else; `architecture.spec.ts` refuses a stored sentence in any other file.
// A new one belongs here only if it cannot be a code the web translates.

/** A task opened because the operation runs through the branch by hand. */
export const BRANCH_TASK_NOTE = 'مهمة فرع';

/** Written in a task's log when its handler's account is frozen and the task goes back to the pool. */
export const HANDLER_FROZEN_NOTE = 'رجعت لأن الحساب أُوقف';

/** The note a task carries when the provider refused the operation; provider health counts these. */
export const PROVIDER_FAILED_NOTE = 'فشل المزود';

/**
 * What the system tells the accounts that may decide on a provider operation (ADR 0019, D15, D16), as the
 * excerpt of a note on the task: the provider's answer is not known, or it confirmed and the line could not be
 * created. They never carry a number, a serial or a code.
 */
export const PROVIDER_UNKNOWN_NOTE = 'نتيجة المزود غير معروفة: المبلغ محجوز والمهمة بانتظار قرار';
export const PROVIDER_EXCEPTION_NOTES = {
  'number-taken': 'نجح التفعيل عند المزود وتعذر إنشاء الخط: الرقم مأخوذ. المبلغ محجوز والمهمة بانتظار قرار',
  'sim-taken': 'نجح التفعيل عند المزود وتعذر إنشاء الخط: الشريحة مأخوذة. المبلغ محجوز والمهمة بانتظار قرار',
  'target-missing': 'نجح التفعيل عند المزود وتعذر إنشاء الخط: الرزمة أو نقطة البيع غير موجودة. المبلغ محجوز والمهمة بانتظار قرار',
  'esim-code-missing': 'نجح التفعيل عند المزود ولم يصل رمز تفعيل eSIM فلم يُنشأ الخط. المبلغ محجوز والمهمة بانتظار قرار',
} as const;

/** The note of an activation task whose request was recorded for the provider and waits to be sent (ADR 0019, T1). */
export const PROVIDER_DISPATCH_NOTE = 'أُرسل الطلب إلى المزود تلقائياً وهو بانتظار نتيجته';

/** The reason a task carries when two accounts released it after the provider's success (ADR 0019, D15). */
export const PROVIDER_RELEASED_NOTE = 'أُلغيت بقرار معتمد من حسابين بعد نجاح المزود، وأُعيد المبلغ المحجوز';

/** Who a notice comes from when no person sent it. */
export const SYSTEM_SENDER_NAME = 'النظام';
