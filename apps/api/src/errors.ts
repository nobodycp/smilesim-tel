// The error contract between the API and the web app.
//
// Every refusal the API sends has the body `{ message, code }`. `code` is a stable identifier
// the web app routes and translates on (redirect to /login, English and Hebrew text). `message`
// is the Arabic sentence, kept word for word so an older web build still shows something right.
//
// apps/web/scripts/check-copy.mjs reads ERROR_MESSAGES below and fails when a code has no
// English or Hebrew text in apps/web/lib/copy. Keep one `CODE: 'message',` entry per line.

export const ERROR_MESSAGES = {
  LOGIN_REQUIRED: 'يلزم تسجيل الدخول',
  DOOR_MISMATCH: 'هذا الحساب ليس لهذا المدخل',
  BAD_CREDENTIALS: 'بيانات الدخول غير صحيحة',
  ACCOUNT_DISABLED: 'الحساب موقوف',
  RATE_LIMITED: 'محاولات كثيرة. أعد المحاولة بعد قليل',
  DUPLICATE_REQUEST: 'الطلب نفسه قيد التنفيذ',
  WRONG_CODE: 'الرمز غير صحيح',
  CODE_EXPIRED: 'انتهت صلاحية الرمز. اطلب رمزاً جديداً',
  CONTACT_MISSING: 'أضف رقم الهاتف أو البريد في الإعدادات أولاً',
  PASSKEY_FAILED: 'تعذّر التحقق من مفتاح المرور',
  APP_CODE_UNAVAILABLE: 'التحقق بتطبيق المصادقة غير متاح الآن. اختر طريقة أخرى',
  WRONG_CURRENT_PASSWORD: 'كلمة السر الحالية غير صحيحة',
  FULL_NAME_INVALID: 'الاسم الكامل من حرفين إلى أربعين حرفاً',
  PASSWORD_TOO_SHORT: 'كلمة السر ثمانية أحرف على الأقل',
  EMAIL_INVALID: 'البريد الإلكتروني غير صحيح',
  PHONE_INVALID: 'رقم الهاتف غير صحيح',
  CITY_INVALID: 'المدينة غير معروفة',
  ADDRESS_INVALID: 'العنوان حتى مئة وعشرين حرفاً',
  INVALID: 'بيانات غير صالحة',
  FORBIDDEN: 'غير مسموح',
  NOT_FOUND: 'غير موجود',
  BALANCE_CEILING: 'الرصيد لا يكفي ضمن السقف',
  PRICE_BELOW_FLOOR: 'سعر البيع أقل من المسموح',
  REPORTS_BRANCH_ONLY: 'التقارير للفرع فقط',
  NOTE_REQUIRED: 'أضف ملاحظة للتمويل',
  HAS_HISTORY: 'لا يُحذف حساب فيه سجل. جمّده.',
  NUMBER_TAKEN: 'الرقم مستخدم',
  SIM_TAKEN: 'رقم الشريحة مستخدم على رقم آخر',
  LOGIN_TAKEN: 'اسم الدخول مستخدم',
  PACKAGE_DISABLED: 'الرزمة متوقفة',
  PACKAGE_HIDDEN: 'الرزمة غير معروضة للبيع',
  OPERATION_DISABLED: 'متوقف على هذه الرزمة',
  OPERATION_DENIED: 'العملية موقوفة على هذا الحساب',
  SWITCH_PACKAGE_FIRST: 'بدّل الرزمة أولاً',
  SIM_DIGITS: 'رقم الشريحة أرقام فقط',
  SIM_LENGTH: 'عدد خانات الشريحة لا يطابق الشركة',
  SIM_PREFIX: 'رقم الشريحة لا يبدأ بمقدّمة الشركة',
  ESIM_UNSUPPORTED: 'الشركة لا تدعم eSIM',
  QR_INVALID: 'صورة رمز QR غير صالحة',
  IMAGE_TOO_LARGE: 'الصورة أكبر من المسموح (700 كيلوبايت)',
  ESIM_PACKAGE_OFF: 'الرزمة غير متاحة كـ eSIM',
  ESIM_CODE_UNREADABLE: 'تعذّرت قراءة رمز eSIM المحفوظ. تواصل مع الدعم',
  // Adding from the provider (spec 2026-11-09-admin-review, 3).
  COMPANY_EXISTS: 'الشركة مضافة من قبل',
  PACKAGE_EXISTS: 'الرزمة مضافة من قبل',
  PRODUCT_NOT_FOUND: 'المزود لا يعرض هذا المنتج',
  // Answers that come from no rule of ours: a body over the limit, and a fault in the server itself.
  TOO_LARGE: 'الطلب أكبر من المسموح',
  SERVER_ERROR: 'حدث خطأ في الخادم. أعد المحاولة',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export const ERROR_CODES = Object.fromEntries(Object.keys(ERROR_MESSAGES).map((code) => [code, code])) as {
  [K in ErrorCode]: K;
};

export type ErrorBody = { message: string; code: ErrorCode };

/** The JSON body of a refusal. */
export function errorBody(code: ErrorCode): ErrorBody {
  return { message: ERROR_MESSAGES[code], code };
}
