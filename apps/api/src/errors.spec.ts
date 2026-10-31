import { ERROR_CODES, ERROR_MESSAGES, errorBody } from './errors';
import { DoorMiddleware } from './door.middleware';
import { MemoryAuthStore } from './modules/auth/auth.store';
import { newPasswordProblem, nicknameProblem, validateNewPassword, validateNickname } from './modules/auth/validators';

// The Arabic sentences the web app showed before the codes existed. A code may be added, but
// no message may change: an older web build still matches on these words.
const LEGACY_MESSAGES: Record<string, string> = {
  LOGIN_REQUIRED: 'يلزم تسجيل الدخول',
  DOOR_MISMATCH: 'هذا الحساب ليس لهذا المدخل',
  BAD_CREDENTIALS: 'بيانات الدخول غير صحيحة',
  ACCOUNT_DISABLED: 'الحساب موقوف',
  RATE_LIMITED: 'محاولات كثيرة. أعد المحاولة بعد قليل',
  WRONG_CODE: 'الرمز غير صحيح',
  WRONG_CURRENT_PASSWORD: 'كلمة السر الحالية غير صحيحة',
  NICKNAME_INVALID: 'النيك نيم من حرفين إلى أربعين حرفاً',
  PASSWORD_TOO_SHORT: 'كلمة السر ثمانية أحرف على الأقل',
  EMAIL_INVALID: 'البريد الإلكتروني غير صحيح',
  PHONE_INVALID: 'رقم الهاتف غير صحيح',
  INVALID: 'بيانات غير صالحة',
  FORBIDDEN: 'غير مسموح',
  NOT_FOUND: 'غير موجود',
  BALANCE_CEILING: 'الرصيد لا يكفي ضمن السقف',
  PRICE_BELOW_FLOOR: 'سعر البيع أقل من المسموح',
  REPORTS_BRANCH_ONLY: 'التقارير للفرع فقط',
  NOTE_REQUIRED: 'أضف ملاحظة للتمويل',
  HAS_HISTORY: 'لا يُحذف حساب فيه سجل. جمّده.',
  NUMBER_TAKEN: 'الرقم مستخدم',
  LOGIN_TAKEN: 'اسم الدخول مستخدم',
  ZERO_WALLET_FIRST: 'صفّر المحفظة قبل النقل',
  PACKAGE_DISABLED: 'الرزمة متوقفة',
  PACKAGE_HIDDEN: 'الرزمة غير معروضة للبيع',
  OPERATION_DISABLED: 'متوقف على هذه الرزمة',
  SWITCH_PACKAGE_FIRST: 'بدّل الرزمة أولاً',
};

describe('error contract', () => {
  it('keeps every code on the Arabic message it always had', () => {
    expect(ERROR_MESSAGES).toEqual(LEGACY_MESSAGES);
  });

  it('lists every code once, spelled in capitals, and maps each to itself', () => {
    const codes = Object.keys(ERROR_MESSAGES);
    expect(Object.keys(ERROR_CODES)).toEqual(codes);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z][A-Z_]*$/);
      expect((ERROR_CODES as Record<string, string>)[code]).toBe(code);
    }
    expect(new Set(Object.values(ERROR_MESSAGES)).size).toBe(codes.length);
  });

  it('builds a body with the message and the code', () => {
    expect(errorBody('BALANCE_CEILING')).toEqual({ message: 'الرصيد لا يكفي ضمن السقف', code: 'BALANCE_CEILING' });
  });

  it('gives the validators a code that matches the message they always returned', () => {
    expect(nicknameProblem('a')).toBe('NICKNAME_INVALID');
    expect(nicknameProblem('ab')).toBeNull();
    expect(validateNickname('a')).toBe(ERROR_MESSAGES.NICKNAME_INVALID);
    expect(newPasswordProblem('short')).toBe('PASSWORD_TOO_SHORT');
    expect(newPasswordProblem('long enough')).toBeNull();
    expect(validateNewPassword('short')).toBe(ERROR_MESSAGES.PASSWORD_TOO_SHORT);
  });

  it('sends the door refusal with its code from the door middleware', async () => {
    const middleware = new DoorMiddleware(new MemoryAuthStore());
    const sent: { status?: number; body?: unknown } = {};
    const res = {
      status(code: number) {
        sent.status = code;
        return this;
      },
      json(body: unknown) {
        sent.body = body;
        return this;
      },
    };
    const req = { headers: { origin: 'http://admin.localhost:3000', 'x-door': 'pos' } };
    await middleware.use(req as never, res as never, () => undefined);
    expect(sent.status).toBe(403);
    expect(sent.body).toEqual({ message: 'هذا الحساب ليس لهذا المدخل', code: 'DOOR_MISMATCH' });
  });
});
