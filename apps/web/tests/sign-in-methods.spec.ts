import { expect, test, type Page } from '@playwright/test';

// Sign-in methods (spec 2026-11-08-signin-methods): the second step by SMS or email, and passkeys made by Chrome's
// virtual authenticator against the mocked API.

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const methods = (over: Record<string, unknown> = {}) => ({
  twoFactorEnabled: false, twoFactorMethod: 'app', canDisable: false, phone: '•••••4567', email: 'p•••@example.com', passkeys: [], ...over,
});
const b64 = (text: string) => Buffer.from(text).toString('base64url');

async function virtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

// SMS and email are hidden in the interface (SHOWN_METHODS, owner 2026-11-11); these two return with them.
test.skip('settings turns on SMS with the code it sends', async ({ page }) => {
  const sent: unknown[] = [];
  await page.route('**/auth/sign-in-methods', (route) => route.fulfill(json(methods())));
  await page.route('**/auth/two-factor/method', (route) => route.fulfill(json({ sentTo: '•••••4567', sent: true, retryIn: 30 })));
  await page.route('**/auth/two-factor/method/confirm', (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill(json({ next: 'app' }));
  });
  await page.goto('/settings');
  await page.getByRole('radio', { name: /SMS/ }).click();
  await page.getByRole('button', { name: 'تفعيل التحقق بخطوتين' }).click();
  await expect(page.getByText('أرسلنا الرمز إلى •••••4567')).toBeVisible();
  await page.getByLabel('الرمز').fill('654321');
  await page.getByRole('button', { name: 'تأكيد التفعيل' }).click();
  await expect(page.getByText('تم تفعيل التحقق بخطوتين', { exact: true })).toBeVisible();
  expect(sent).toEqual([{ method: 'sms', code: '654321' }]);
});

test.skip('a method without a phone or email cannot be chosen', async ({ page }) => {
  await page.route('**/auth/sign-in-methods', (route) => route.fulfill(json(methods({ phone: null }))));
  await page.goto('/settings');
  await page.getByRole('radio', { name: /SMS/ }).click();
  await expect(page.getByText('أضف رقم الهاتف أو البريد في بياناتك لاستخدام هذه الطريقة.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'تفعيل التحقق بخطوتين' })).toBeDisabled();
});

test('the code page sends the SMS code on arrival and counts down to a resend', async ({ page }) => {
  await page.route('**/auth/two-factor/send', (route) => route.fulfill(json({ method: 'sms', sentTo: '•••••4567', sent: true, retryIn: 30 })));
  await page.addInitScript(() => sessionStorage.setItem('twoFactorStep', 'code'));
  await page.goto('/two-factor');
  await expect(page.getByText('أدخل الرمز الذي وصلك برسالة نصية.')).toBeVisible();
  await expect(page.getByText('أرسلنا الرمز إلى •••••4567')).toBeVisible();
  await expect(page.getByRole('button', { name: /^أعد الإرسال \(\d+\)$/ })).toBeDisabled();
});

test('adds a passkey in settings, then signs in with it', async ({ page }) => {
  await virtualAuthenticator(page);
  const added: { name?: string; response?: { id?: string } }[] = [];
  const signedIn: { loginId?: string; response?: { id?: string } }[] = [];
  await page.route('**/auth/sign-in-methods', (route) => route.fulfill(json(methods())));
  await page.route('**/auth/passkeys/options', (route) => route.fulfill(json({
    challenge: b64('register-challenge'),
    rp: { name: 'SmileSim', id: 'pos.localhost' },
    user: { id: b64('pos'), name: 'pos', displayName: 'pos' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    attestation: 'none',
    timeout: 60000,
  })));
  await page.route('**/auth/passkeys', (route) => {
    added.push(route.request().postDataJSON());
    return route.fulfill(json({ id: 'pk1', name: 'Laptop', createdAt: '2026-11-08T00:00:00.000Z', lastUsedAt: null }));
  });
  await page.goto('/settings');
  await page.getByLabel('اسم المفتاح').fill('Laptop');
  await page.getByRole('button', { name: 'إضافة مفتاح' }).click();
  await expect(page.getByText('تمت إضافة المفتاح')).toBeVisible();
  expect(added[0]?.name).toBe('Laptop');
  expect(added[0]?.response?.id).toBeTruthy();

  await page.route('**/auth/passkey-login/options', (route) => route.fulfill(json({
    loginId: 'once-1',
    options: { challenge: b64('login-challenge'), rpId: 'pos.localhost', userVerification: 'preferred', timeout: 60000 },
  })));
  await page.route('**/auth/passkey-login', (route) => {
    signedIn.push(route.request().postDataJSON());
    return route.fulfill(json({ next: 'app' }));
  });
  await page.goto('/login');
  await page.getByRole('button', { name: 'الدخول بمفتاح المرور' }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  expect(signedIn[0]?.loginId).toBe('once-1');
  expect(signedIn[0]?.response?.id).toBe(added[0]?.response?.id);
});

// Spec 2026-11-12-two-factor-available-methods: the enrolment screen offers what the API allows and nothing else.
for (const [allowed, name] of [[['app'], 'تطبيق المصادقة'], [['sms'], 'رسالة نصية (SMS)']] as const) {
  test(`the enrolment page proposes only what the API allows (${allowed.join(',')})`, async ({ page }) => {
    const asked: string[] = [];
    await page.route('**/auth/two-factor/methods', (route) => route.fulfill(json({ allowedMethods: allowed })));
    await page.route('**/auth/two-factor/setup', (route) => {
      asked.push('setup');
      return route.fulfill(json({ otpauth: 'otpauth://totp/x?secret=ABC' }));
    });
    await page.route('**/auth/two-factor/method', (route) => {
      asked.push('method');
      return route.fulfill(json({ sentTo: '•••••4567', sent: true, retryIn: 30 }));
    });
    await page.addInitScript(() => sessionStorage.setItem('twoFactorStep', 'enroll'));
    await page.goto('/two-factor');
    await expect(page.locator('form')).toBeVisible();
    await expect(page.locator('p.hint', { hasText: name })).toBeVisible();
    await page.waitForTimeout(500);
    // The app's secret is asked for only when the app is what the API allows: no call the API would refuse.
    expect(asked.filter((call) => call === 'setup')).toHaveLength(allowed[0] === 'app' ? 1 : 0);
  });
}

test('the code page says so when the account\'s method cannot be carried out, instead of waiting for a code', async ({ page }) => {
  await page.route('**/auth/two-factor/send', (route) =>
    route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'METHOD_UNAVAILABLE', message: 'طريقة التحقق هذه غير متاحة حالياً. المتاح تطبيق المصادقة، أو راجع إدارة الفرع' }) }),
  );
  await page.addInitScript(() => sessionStorage.setItem('twoFactorStep', 'code'));
  await page.goto('/two-factor');
  await expect(page.getByText('طريقة التحقق هذه غير متاحة حالياً. المتاح تطبيق المصادقة، أو راجع إدارة الفرع')).toBeVisible();
});
