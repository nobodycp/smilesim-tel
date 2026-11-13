# سمايل سيم

مكتب بيع بالجملة لشرائح الاتصال بواجهة عربية من اليمين إلى اليسار (وإنجليزية وعبرية). أربع طبقات في سلّم واحد: الفرع، الوكيل الرئيسي، الوكيل، نقطة البيع. لكل طبقة بابها، وكل بابٍ يرى ما تسمح به طبقته. قواعد النظام الكاملة في [`docs/project-plan.md`](docs/project-plan.md).

- `apps/api`: NestJS 12 وPrisma 7 (PostgreSQL) وBullMQ وRedis.
- `apps/web`: Next.js 16 وReact 19.

## الأبواب

الباب يُحدَّد من اسم المضيف، وكلها على المنفذ نفسه:

| الباب | العنوان المحلي |
|---|---|
| الفرع | `http://admin.localhost:3000` |
| الوكيل الرئيسي | `http://main.localhost:3000` |
| الوكيل | `http://agent.localhost:3000` |
| نقطة البيع | `http://pos.localhost:3000` |

`http://localhost:3000` يعرض صفحة اختيار الباب. المتصفحات الحديثة تحلّ `*.localhost` إلى الجهاز بلا إعداد.

## التشغيل المحلي

```bash
docker compose up --build
```

يرفع web على 3000 وapi على 3001 وworker وpostgres وredis، ويطبّق الهجرات عند إقلاع الـ api. `docker-compose.override.yml` يُحمَّل تلقائياً محلياً ويفعّل حسابات التجربة `branch` و`main` و`agent` و`pos` بكلمة السر `123456` (للتطوير فقط، انظر `.env.example`). لا حاجة لملف `.env`؛ انسخ `.env.example` إلى `.env` فقط لتغيير قيمة.

بلا docker: شغّل postgres وredis، ثم من الجذر `npm ci` و`npm run prisma:generate`، ثم `npm run build --workspace api` و`npm run start --workspace api` و`npm run dev --workspace web`. المطلوب Node 24 أو أحدث (`.nvmrc`).

## السكربتات (من الجذر)

| الأمر | ما يفعله |
|---|---|
| `npm run lint` | eslint للحزمتين |
| `npm run typecheck` | `tsc --noEmit` للـ api وللـ web |
| `npm test` | اختبارات jest للـ api (بلا قاعدة بيانات) |
| `npm run test:e2e` | اختبارات Playwright للـ web على api وهمي (`npx playwright install chromium` أولاً) |
| `npm run build` | بناء الحزمتين. بناء web يكتب في `.next`؛ لا تشغّله بينما خادم التطوير يعمل، أو استعمل `NEXT_DIST_DIR=.next-build` |
| `npm run prisma:generate` | يولّد عميل Prisma من المخطط |

يعمل `.github/workflows/ci.yml` عند كل push وpull request: lint وtypecheck واختبارات api وبناء الحزمتين. اختبارات Playwright في job منفصل `e2e` لا يمنع الدمج حالياً.

## بنية المجلدات

```
apps/api/        الـ API
  src/modules/auth/     الدخول والجلسات والتحقق الثنائي
  src/modules/office/   عمليات المكتب: الأرقام والرزم والمحافظ والمهام
  prisma/               المخطط والهجرات
apps/web/        الواجهة
  app/                  الصفحات و globals.css
  components/           الهيكل والجداول والحوارات المشتركة
  lib/                  العميل api.ts والنصوص والأبواب
  tests/                Playwright
docs/            الخطة والمواصفات: project-plan.md وsuperpowers/specs وplans وgates
DESIGN.md        نظام التصميم، مصدر الحقيقة البصري
.cursor/rules/   قواعد العمل والواجهة
```

التصميم في [`DESIGN.md`](DESIGN.md). كل تغيير جديد يبدأ بمواصفة وخطة في [`docs/superpowers`](docs/superpowers) قبل الكود.

## الأمان: headers وCSP

`apps/web/next.config.mjs` يضيف `X-Content-Type-Options` و`Referrer-Policy` و`X-Frame-Options` و`Permissions-Policy` لكل المسارات. `Content-Security-Policy` يبنيه `apps/web/proxy.ts` لكل طلب مع nonce جديد، لأن السكربت المضمّن في `components/bootstrap.tsx` لا يعمل إلا بهذا الـ nonce (لا `unsafe-inline` للسكربتات). في التطوير يُضاف `unsafe-eval` وws لـ HMR فقط. لإضافة مصدر جديد (صور من مضيف، أو api على أصل آخر) عدّل التوجيه المناسب في دالة `contentSecurityPolicy` داخل `proxy.ts` (`img-src` أو `connect-src` أو `font-src`) واكتب سببه في تعليق.

## النشر على Coolify

`docker-compose.yml` يصلح ملف نشر: Coolify يقرؤه وحده ولا يقرأ `docker-compose.override.yml`، فلا تُزرع حسابات التجربة. (النشر القائم اليوم ليس بهذه الطريقة: هو ثلاثة تطبيقات Dockerfile منفصلة، لكل منها متغيراته، ومنها `SECRETS_KEY` الذي يُضبط على الـAPI **وعلى الـWorker** بالقيمة نفسها. التفاصيل في `docs/handover/technical-operations-ar.md`.)

1. أنشئ مورداً من هذا المستودع بنوع Docker Compose.
2. اضبط المتغيرات في Coolify (القائمة في `.env.example`):
   - `NEXT_PUBLIC_API_URL`: عنوان الـ api العام. **متغير بناء** لـ web، يُدمج وقت البناء، فتغييره يعني إعادة بناء web.
   - `WEB_ORIGIN`: عنوان web العام، الأصل الوحيد الذي يسمح به الـ api مع الكوكيز.
   - `COOKIE_SECURE=true`.
   - `COOKIE_DOMAIN`: النطاق الأب المشترك بين web وapi (مثل `example.com`) حتى تعمل جلسة واحدة عبر الأبواب الأربعة.
   - `DATABASE_URL` و`REDIS_URL` إن استعملت خدمتين خارجيتين بدل postgres وredis في الملف.
3. اربط نطاقات الأبواب `admin` و`main` و`agent` و`pos` على النطاق الأب بخدمة web، ونطاق الـ api بخدمة api.
4. لا تضع `TRIAL_SEED` ولا `TRIAL_SEED_ALLOW_PRODUCTION`. على قاعدة فارغة يقلع الـ api بلا حسابات ويكتب تحذيراً في السجل، فأنشئ أول صاحب فرع بطريقة خارجية.
5. خدمة api تشغّل `prisma migrate deploy` عند كل إقلاع؛ خدمة worker تعمل من الصورة نفسها.
