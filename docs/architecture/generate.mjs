#!/usr/bin/env node
/**
 * Builds docs/architecture/*.excalidraw from the catalogue in
 * docs/superpowers/specs/2026-11-02-web-architecture-excalidraw-design.md (D4: Arabic roles).
 * Run: node docs/architecture/generate.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
let seq = 1;
const id = (p = 'e') => `${p}${seq++}`;
const seed = () => Math.floor(Math.random() * 2 ** 31);

const COLORS = {
  root: { bg: '#e9ecef', stroke: '#495057' },
  app: { bg: '#d0ebff', stroke: '#1c7ed6' },
  components: { bg: '#d3f9d8', stroke: '#2f9e44' },
  lib: { bg: '#fff3bf', stroke: '#f08c00' },
  styles: { bg: '#e5dbff', stroke: '#7048e8' },
  flow: { bg: '#f8f9fa', stroke: '#343a40' },
  context: { bg: '#d0ebff', stroke: '#1c7ed6' },
  action: { bg: '#d3f9d8', stroke: '#2f9e44' },
  error: { bg: '#ffe3e3', stroke: '#e03131' },
  identity: { bg: '#fff3bf', stroke: '#f08c00' },
  side: { bg: '#f1f3f5', stroke: '#868e96' },
  title: '#212529',
};

function base(el) {
  return {
    angle: 0,
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    seed: seed(),
    versionNonce: seed(),
    isDeleted: false,
    updated: Date.now(),
    link: null,
    locked: false,
    ...el,
  };
}

function rect(x, y, w, h, { bg, stroke, id: rid } = {}) {
  return base({
    id: rid || id('r'),
    type: 'rectangle',
    x,
    y,
    width: w,
    height: h,
    strokeColor: stroke || '#212529',
    backgroundColor: bg || '#ffffff',
    roundness: { type: 3 },
    boundElements: [],
  });
}

function textEl(x, y, text, { fontSize = 14, stroke = COLORS.title, align = 'right', width, id: tid } = {}) {
  const lines = String(text).split('\n');
  const fs = fontSize;
  const lineHeight = 1.25;
  const w = width ?? Math.max(40, ...lines.map((l) => [...l].length)) * fs * 0.55;
  const h = Math.max(fs * lineHeight, lines.length * fs * lineHeight);
  return base({
    id: tid || id('t'),
    type: 'text',
    x,
    y,
    width: w,
    height: h,
    strokeColor: stroke,
    backgroundColor: 'transparent',
    roundness: null,
    boundElements: null,
    text,
    fontSize: fs,
    fontFamily: 2,
    textAlign: align,
    verticalAlign: 'top',
    containerId: null,
    originalText: text,
    autoResize: true,
    lineHeight,
  });
}

function arrow(x, y, points, { stroke = '#495057', start, end } = {}) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const norm = points.map(([px, py]) => [px - minX, py - minY]);
  return base({
    id: id('a'),
    type: 'arrow',
    x: x + minX,
    y: y + minY,
    width: Math.max(...norm.map((p) => p[0])) - Math.min(...norm.map((p) => p[0])),
    height: Math.max(...norm.map((p) => p[1])) - Math.min(...norm.map((p) => p[1])),
    strokeColor: stroke,
    backgroundColor: 'transparent',
    roundness: { type: 2 },
    boundElements: null,
    points: norm,
    lastCommittedPoint: null,
    startBinding: start || null,
    endBinding: end || null,
    startArrowhead: null,
    endArrowhead: 'arrow',
  });
}

function card(x, y, w, h, title, role, palette) {
  const box = rect(x, y, w, h, palette);
  const pad = 8;
  const titleT = textEl(x + pad, y + pad, title, {
    fontSize: 13,
    align: 'left',
    width: w - pad * 2,
    stroke: palette.stroke,
  });
  const roleT = textEl(x + pad, y + pad + 20, role, {
    fontSize: 12,
    align: 'right',
    width: w - pad * 2,
    stroke: '#495057',
  });
  return [box, titleT, roleT];
}

function sectionHeader(x, y, w, label, palette) {
  const box = rect(x, y, w, 40, { bg: palette.stroke, stroke: palette.stroke });
  const t = textEl(x + 12, y + 10, label, {
    fontSize: 16,
    align: 'left',
    width: w - 24,
    stroke: '#ffffff',
  });
  return [box, t];
}

function document(elements) {
  return {
    type: 'excalidraw',
    version: 2,
    source: 'smilesim-tel docs/architecture/generate.mjs',
    elements,
    appState: {
      gridSize: null,
      viewBackgroundColor: '#ffffff',
    },
    files: {},
  };
}

/** @type {{ zone: string, file: string, role: string }[]} */
const CATALOGUE = [
  // Root
  { zone: 'root', file: 'app/layout.tsx', role: 'الجذر: خطوط، الباب من المضيف، تهيئة Prefs / Toasts / Door / OfficeSession' },
  { zone: 'root', file: 'features/desk/screens/home-screen.tsx', role: 'صفحة الهوم عند وجود باب (إحصاءات / اختصارات / لوحات)' },
  { zone: 'root', file: 'app/globals.css', role: 'يستورد فقط ملفات app/styles/*' },
  { zone: 'root', file: 'app/icon.svg', role: 'أيقونة التطبيق / المفضلة' },
  { zone: 'root', file: 'proxy.ts', role: 'CSP وnonce لكل طلب وسلوك حافة مرتبط بالباب' },

  // Auth routes
  { zone: 'app', file: 'features/auth/screens/login-screen.tsx', role: 'نموذج تسجيل الدخول للباب' },
  { zone: 'app', file: 'features/auth/screens/password-screen.tsx', role: 'خطوة كلمة المرور (إجبارية / تغيير)' },
  { zone: 'app', file: 'features/auth/screens/two-factor-screen.tsx', role: 'تفعيل أو إدخال رمز المصادقة الثنائية' },
  { zone: 'app', file: 'features/auth/screens/settings-screen.tsx', role: 'مكتب إعدادات الحساب' },

  // Desk routes
  { zone: 'app', file: 'features/accounts/screens/users-screen.tsx', role: 'قائمة المستخدمين' },
  { zone: 'app', file: 'features/accounts/screens/account-screen.tsx', role: 'تفاصيل مستخدم وعملياته' },
  { zone: 'app', file: 'features/roles/screens/roles-screen.tsx', role: 'الأدوار والصلاحيات' },
  { zone: 'app', file: 'features/catalog/screens/providers-screen.tsx', role: 'قائمة المزودين' },
  { zone: 'app', file: 'features/catalog/screens/provider-packages-screen.tsx', role: 'تفاصيل مزود' },
  { zone: 'app', file: 'features/catalog/screens/package-sheet-screen.tsx', role: 'باقة تحت مزود' },
  { zone: 'app', file: 'features/catalog/screens/companies-screen.tsx', role: 'قائمة الشركات' },
  { zone: 'app', file: 'features/catalog/screens/company-screen.tsx', role: 'تفاصيل شركة' },
  { zone: 'app', file: 'features/catalog/screens/company-packages-screen.tsx', role: 'شريحة شركة × مزود' },
  { zone: 'app', file: 'features/catalog/screens/packages-screen.tsx', role: 'مكتب الباقات' },
  { zone: 'app', file: 'features/lines/screens/numbers-screen.tsx', role: 'قائمة الأرقام / الشرائح' },
  { zone: 'app', file: 'features/lines/screens/line-card-screen.tsx', role: 'عمليات رقم واحد' },
  { zone: 'app', file: 'features/tasks/screens/tasks-screen.tsx', role: 'مكتب المهام' },
  { zone: 'app', file: 'features/wallets/screens/operations-screen.tsx', role: 'مكتب العمليات' },
  { zone: 'app', file: 'features/wallets/screens/finance-screen.tsx', role: 'التقرير المالي' },
  { zone: 'app', file: 'features/wallets/screens/provider-operations-screen.tsx', role: 'عمليات المزودين وتكلفتها' },
  { zone: 'app', file: 'app/reports/page.tsx', role: 'فهرس التقارير' },
  { zone: 'app', file: 'features/reports/screens/report-screen.tsx', role: 'تقرير من نوع واحد' },
  { zone: 'app', file: 'features/audit/screens/audit-screen.tsx', role: 'سجل التدقيق' },

  // Styles (shown in styles palette, still app/)
  { zone: 'styles', file: 'app/styles/tokens.css', role: 'توكنز --rd-* للفاتح والغامق' },
  { zone: 'styles', file: 'app/styles/base.css', role: 'أساس المستند والطباعة والإعادة' },
  { zone: 'styles', file: 'app/styles/shell.css', role: 'توب بار وسايدبار ودرج الشل' },
  { zone: 'styles', file: 'app/styles/desk/frame.css', role: 'إطار الصفحة: الكانفس ورأس الصفحة والتمرير' },
  { zone: 'styles', file: 'app/styles/desk/pane.css', role: 'اللوحات والتبويبات وصفوف الحقول' },
  { zone: 'styles', file: 'app/styles/desk/table.css', role: 'جدول البيانات وخلاياه والترقيم' },
  { zone: 'styles', file: 'app/styles/desk/filters.css', role: 'شريط الفلاتر والبحث وشرائح الفترة' },
  { zone: 'styles', file: 'app/styles/desk/components.css', role: 'الحالة الفارغة والهياكل والإحصاء والمفتاح وبطاقات العمليات' },
  { zone: 'styles', file: 'app/styles/desk/numbers.css', role: 'بطاقة الرقم' },
  { zone: 'styles', file: 'app/styles/desk/tasks.css', role: 'المهام والتذكرة وشجرة الفحص' },
  { zone: 'styles', file: 'app/styles/desk/users.css', role: 'صفحة المستخدم: الصلاحيات وشروط الرزم' },
  { zone: 'styles', file: 'app/styles/desk/packages.css', role: 'الرزم والشركات وورقة الرزمة' },
  { zone: 'styles', file: 'app/styles/desk/home.css', role: 'الصفحة الرئيسية' },
  { zone: 'styles', file: 'app/styles/desk/settings.css', role: 'الملف الشخصي' },
  { zone: 'styles', file: 'app/styles/desk/branding.css', role: 'هوية الموقع' },
  { zone: 'styles', file: 'app/styles/forms.css', role: 'حقول النماذج والتسميات' },
  { zone: 'styles', file: 'app/styles/controls.css', role: 'عناصر تحكم مشتركة' },
  { zone: 'styles', file: 'app/styles/dialog.css', role: 'طبقة وحسم الحوار' },
  { zone: 'styles', file: 'app/styles/auth.css', role: 'غرفة تسجيل الدخول' },
  { zone: 'styles', file: 'app/styles/doors.css', role: 'صفحة اختيار الباب' },
  { zone: 'styles', file: 'app/styles/responsive.css', role: 'نقاط التوقف والتخطيطات الكثيفة' },
  { zone: 'styles', file: 'app/styles/ui.css', role: 'أنماط مكونات components/ui ومساعدات الاتجاه' },

  // Components shell
  { zone: 'components', file: 'components/bootstrap.tsx', role: 'سكربت أول رسم: مزامنة لغة/ثيم/هوية' },
  { zone: 'components', file: 'components/preferences.tsx', role: 'بذرة التفضيلات وتطبيقها على html' },
  { zone: 'components', file: 'components/doors.tsx', role: 'لا باب على المضيف: منتقي الأبواب الأربعة' },
  { zone: 'components', file: 'components/office-shell.tsx', role: 'شل المكتب: تنقل، محفظة، إشعارات، حساب' },
  { zone: 'components', file: 'components/desk.tsx', role: 'غلاف الصفحة: شل + هوية + مساعدات المكتب' },
  { zone: 'components', file: 'components/chrome.tsx', role: 'تبديل الثيم واللغة' },
  { zone: 'components', file: 'components/shell-search.tsx', role: 'بحث عام في الشريط العلوي' },
  { zone: 'components', file: 'components/auth-frame.tsx', role: 'إطار صفحات الدخول وكلمة المرور و2FA' },
  { zone: 'components', file: 'components/back-link.tsx', role: 'رجوع يراعي اتجاه الكتابة' },
  { zone: 'components', file: 'components/icon.tsx', role: 'أيقونات SVG مسماة للشل والتنقل' },
  { zone: 'components', file: 'components/stat.tsx', role: 'بلاطة مؤشر في الهوم' },
  { zone: 'components', file: 'components/toast.tsx', role: 'مزوّد التوست والتكديس' },
  { zone: 'components', file: 'components/loading.tsx', role: 'سبينر وهياكل تحميل' },
  { zone: 'components', file: 'components/empty-state.tsx', role: 'حالة فارغة داخل اللوحة' },
  { zone: 'components', file: 'components/names.ts', role: 'ترجمة رموز الـ API إلى نصوص العرض' },
  { zone: 'components', file: 'components/line-actions.ts', role: 'عمليات كتابة مشتركة لسطر الرقم' },
  { zone: 'components', file: 'components/filter-bar.tsx', role: 'شريط/لوحة الفلاتر فوق الجداول' },
  { zone: 'components', file: 'components/data-table.tsx', role: 'جدول قابل للفرز مع paging وهيكل فارغ' },
  { zone: 'components', file: 'components/table-search.tsx', role: 'بحث داخل الجدول' },
  { zone: 'components', file: 'components/trend-line.tsx', role: 'خط اتجاه متحرك (بطاقات الرئيسية ورسم الرصيد)' },
  { zone: 'components', file: 'components/row-menu.tsx', role: 'قائمة عمليات الصف (المحفّز الوحيد لكل صف)' },
  { zone: 'components', file: 'components/dialog.tsx', role: 'حوار (تأكيد / نموذج / واسع)' },
  { zone: 'components', file: 'components/data-image.tsx', role: 'صورة data:/blob: من الواجهة' },
  { zone: 'components', file: 'components/facts.tsx', role: 'قائمة تسمية/قيمة بثلاث كثافات' },
  { zone: 'components', file: 'components/alert.tsx', role: 'سطر الخطأ أو النجاح الموحد' },
  { zone: 'components', file: 'components/ui/button.tsx', role: 'أزرار بأحجام وأنماط' },
  { zone: 'components', file: 'components/ui/badge.tsx', role: 'شارة حالة / نغمة' },
  { zone: 'components', file: 'components/ui/select.tsx', role: 'قائمة اختيار' },
  { zone: 'components', file: 'components/ui/pagination.tsx', role: 'تحكم الصفحات وحجم الصفحة' },

  // Lib
  { zone: 'lib', file: 'lib/api.ts', role: 'عميل fetch: كوكي الجلسة وx-door ورمز الخطأ' },
  { zone: 'lib', file: 'lib/doors.ts', role: 'كتالوج مضيف الباب ↔ الطبقة' },
  { zone: 'lib', file: 'lib/door-context.tsx', role: 'سياق React للباب النشط' },
  { zone: 'lib', file: 'lib/office-session.tsx', role: 'يجلب /office/me ويعرض me/الجاهزية' },
  { zone: 'lib', file: 'lib/prefs.tsx', role: 'لغة وثيم وحجم صفحة وt وapiText' },
  { zone: 'lib', file: 'lib/document-prefs.ts', role: 'مفاتيح وكوكيز التفضيلات ومحلّلاتها' },
  { zone: 'lib', file: 'lib/identity.ts', role: 'اسم الحساب والرصيد الظاهران في الشل' },
  { zone: 'lib', file: 'lib/copy/index.ts', role: 'دخول جداول اللغات وtranslateApi' },
  { zone: 'lib', file: 'lib/copy/ar.ts', role: 'النصوص العربية (مصدر الحقيقة)' },
  { zone: 'lib', file: 'lib/copy/en.ts', role: 'النصوص الإنجليزية' },
  { zone: 'lib', file: 'lib/copy/he.ts', role: 'النصوص العبرية' },
  { zone: 'lib', file: 'lib/grants.ts', role: 'قائمة رموز المنح وتسمياتها' },
  { zone: 'lib', file: 'lib/company-mark.ts', role: 'حروف وعلامة الشركة وتصغير الشعار' },
  { zone: 'lib', file: 'lib/fetched.ts', role: 'شكل جواب الـ API ودالة pick' },
  { zone: 'lib', file: 'lib/use-api-query.ts', role: 'قراءة واحدة مخزّنة في كاش الاستعلامات' },
  { zone: 'lib', file: 'lib/use-paged.ts', role: 'خطاف قوائم متتابعة بالمؤشر' },
  { zone: 'lib', file: 'lib/use-action.ts', role: 'خطاف كتابة مع busy والخطأ' },
  { zone: 'lib', file: 'lib/status-tone.ts', role: 'خريطة الحالة إلى لون الشارة' },
  { zone: 'lib', file: 'lib/reload-at.ts', role: 'تحميل كامل مقصود عند تغيّر الحساب' },
  { zone: 'lib', file: 'lib/use-popover.ts', role: 'محرك فتح وإغلاق القوائم والنوافذ المنبثقة' },
  { zone: 'lib', file: 'lib/use-require-layer.ts', role: 'تحويل عند طبقة باب غير مسموحة' },
];

const ZONE_META = {
  root: { title: '1 · الجذر / Root', palette: COLORS.root, x: 40 },
  app: { title: '2 · الشاشات features/*/screens (الصفحة في app/ تعيد تصديرها)', palette: COLORS.app, x: 360 },
  styles: { title: '2ب · الأنماط styles/', palette: COLORS.styles, x: 680 },
  components: { title: '3 · المكوّنات components/', palette: COLORS.components, x: 1000 },
  lib: { title: '4 · المكتبة lib/', palette: COLORS.lib, x: 1320 },
};

function buildTreeBoard() {
  const elements = [];
  elements.push(
    ...sectionHeader(40, 20, 1600, 'سمايل سيم — شجرة مكوّنات الفرونت (كل ملف + دوره)', {
      bg: '#212529',
      stroke: '#212529',
    }),
  );
  elements.push(
    textEl(
      40,
      70,
      'افتح في إضافة Excalidraw في Cursor · المسارات بالإنجليزية · الأدوار بالعربية · المصدر: docs/superpowers/specs/2026-11-02-web-architecture-excalidraw-design.md',
      { fontSize: 12, align: 'left', width: 1600, stroke: '#868e96' },
    ),
  );

  const cardW = 300;
  const cardH = 58;
  const gap = 10;
  const startY = 110;

  for (const [zone, meta] of Object.entries(ZONE_META)) {
    const items = CATALOGUE.filter((c) => c.zone === zone);
    let y = startY;
    elements.push(...sectionHeader(meta.x, y, cardW, meta.title, meta.palette));
    y += 48;
    for (const item of items) {
      elements.push(...card(meta.x, y, cardW, cardH, item.file, item.role, meta.palette));
      y += cardH + gap;
    }
  }

  // Containment hint arrows between zone headers
  const ys = startY + 20;
  const headers = Object.values(ZONE_META);
  for (let i = 0; i < headers.length - 1; i++) {
    const a = headers[i];
    const b = headers[i + 1];
    elements.push(
      arrow(0, 0, [
        [a.x + cardW, ys],
        [b.x, ys],
      ], { stroke: '#adb5bd' }),
    );
  }

  return document(elements);
}

function flowBox(x, y, w, h, title, body, palette) {
  const boxId = id('fb');
  const box = rect(x, y, w, h, { ...palette, id: boxId });
  const titleT = textEl(x + 10, y + 10, title, {
    fontSize: 14,
    align: 'left',
    width: w - 20,
    stroke: palette.stroke,
  });
  const bodyT = textEl(x + 10, y + 34, body, {
    fontSize: 12,
    align: 'right',
    width: w - 20,
    stroke: '#343a40',
  });
  return { elements: [box, titleT, bodyT], id: boxId, x, y, w, h };
}

function buildFlowBoard() {
  const elements = [];
  elements.push(
    ...sectionHeader(40, 20, 1400, 'سمايل سيم — مسارات الحالة والبيانات (الفرونت)', {
      bg: '#212529',
      stroke: '#212529',
    }),
  );
  elements.push(
    textEl(40, 70, 'خمس مناطق · أسهم للعلاقات الحية فقط · للأخطاء والهوية والجلسات', {
      fontSize: 12,
      align: 'left',
      width: 1400,
      stroke: '#868e96',
    }),
  );

  const bandY = [110, 280, 470, 660, 850];
  const bandLabels = [
    '١ · إقلاع الطلب',
    '٢ · طبقات الحالة (Contexts)',
    '٣ · قراءة/كتابة الصفحات',
    '٤ · مسار الخطأ',
    '٥ · هوية الشل',
  ];

  for (let i = 0; i < bandLabels.length; i++) {
    elements.push(
      textEl(40, bandY[i] - 28, bandLabels[i], {
        fontSize: 15,
        align: 'left',
        width: 400,
        stroke: '#212529',
      }),
    );
  }

  // Band 1 boot
  const host = flowBox(40, bandY[0], 180, 100, 'Host', 'اسم المضيف\n*.localhost', COLORS.flow);
  const doorFrom = flowBox(260, bandY[0], 200, 100, 'doorFromHost', 'lib/doors.ts\nاستخراج الباب', COLORS.flow);
  const branch = flowBox(500, bandY[0], 220, 100, 'باب موجود؟', 'نعم → مزوّدات\nلا → Doors', COLORS.flow);
  const providers = flowBox(760, bandY[0], 280, 100, 'DoorProvider + OfficeSession', 'door-context + office-session\nيلفّ الصفحات', COLORS.context);
  const doorsPage = flowBox(1080, bandY[0], 220, 100, 'Doors', 'components/doors.tsx\nاختيار الباب', COLORS.app);
  const boot = flowBox(40, bandY[0] + 120, 320, 70, 'Bootstrap + Preferences', 'مزامنة كوكي/localStorage → prefs', COLORS.side);
  elements.push(
    ...host.elements,
    ...doorFrom.elements,
    ...branch.elements,
    ...providers.elements,
    ...doorsPage.elements,
    ...boot.elements,
  );
  elements.push(
    arrow(0, 0, [[host.x + host.w, host.y + 50], [doorFrom.x, doorFrom.y + 50]]),
    arrow(0, 0, [[doorFrom.x + doorFrom.w, doorFrom.y + 50], [branch.x, branch.y + 50]]),
    arrow(0, 0, [[branch.x + branch.w, branch.y + 35], [providers.x, providers.y + 35]]),
    arrow(0, 0, [[branch.x + branch.w, branch.y + 70], [doorsPage.x, doorsPage.y + 70]], {
      stroke: '#868e96',
    }),
  );

  // Band 2 contexts
  const prefs = flowBox(40, bandY[1], 240, 120, 'Prefs', 'لغة · ثيم · حجم صفحة\nt / apiText\nlib/prefs.tsx', COLORS.context);
  const doorCtx = flowBox(320, bandY[1], 240, 120, 'Door', 'الطبقة الحالية\nصلاحيات ظاهرة\nlib/door-context.tsx', COLORS.context);
  const office = flowBox(600, bandY[1], 260, 120, 'OfficeSession', 'me / رصيد / ready\nيتخطّى مسارات auth\nlib/office-session.tsx', COLORS.context);
  const toasts = flowBox(900, bandY[1], 240, 120, 'Toasts', 'رسائل عابرة\ncomponents/toast.tsx', COLORS.context);
  elements.push(...prefs.elements, ...doorCtx.elements, ...office.elements, ...toasts.elements);

  // Band 3 page I/O
  const page = flowBox(40, bandY[2], 180, 120, 'Page', 'أي page.tsx\nفي المكتب', COLORS.app);
  const hooks = flowBox(260, bandY[2], 280, 120, 'Hooks', 'useApiQuery · usePaged · useAction\nuse-require-layer', COLORS.action);
  const api = flowBox(580, bandY[2], 260, 120, 'api.ts', 'credentials + x-door\nنتيجة ok أو code', COLORS.action);
  const backend = flowBox(880, bandY[2], 240, 120, '/api → Nest', 'جلسة الكوكي\nالخادم يقرّر', COLORS.flow);
  elements.push(...page.elements, ...hooks.elements, ...api.elements, ...backend.elements);
  elements.push(
    arrow(0, 0, [[page.x + page.w, page.y + 60], [hooks.x, hooks.y + 60]]),
    arrow(0, 0, [[hooks.x + hooks.w, hooks.y + 60], [api.x, api.y + 60]]),
    arrow(0, 0, [[api.x + api.w, api.y + 60], [backend.x, backend.y + 60]]),
  );

  // Band 4 errors
  const fail = flowBox(40, bandY[3], 260, 120, 'فشل', 'شبكة أو رد غير ok\nmessage + code', COLORS.error);
  const show = flowBox(340, bandY[3], 280, 120, 'عرض الخطأ', 'apiText من Prefs\nأو toast.push', COLORS.error);
  const endSession = flowBox(660, bandY[3], 320, 120, 'إنهاء الجلسة؟', 'LOGIN_REQUIRED\nDOOR_MISMATCH\n→ window → /login', COLORS.error);
  elements.push(...fail.elements, ...show.elements, ...endSession.elements);
  elements.push(
    arrow(0, 0, [[api.x + api.w / 2, api.y + api.h], [fail.x + 80, fail.y]], { stroke: '#e03131' }),
    arrow(0, 0, [[fail.x + fail.w, fail.y + 60], [show.x, show.y + 60]], { stroke: '#e03131' }),
    arrow(0, 0, [[show.x + show.w, show.y + 60], [endSession.x, endSession.y + 60]], {
      stroke: '#e03131',
    }),
  );

  // Band 5 identity
  const sess = flowBox(40, bandY[4], 260, 120, 'OfficeSession', 'بعد officeMe الناجح\nrememberIdentity/Balance', COLORS.identity);
  const ident = flowBox(340, bandY[4], 280, 120, 'identity.ts', 'sessionStorage\n+ كوكي الاسم/الرصيد', COLORS.identity);
  const shell = flowBox(660, bandY[4], 280, 120, 'OfficeShell', 'يعرض الاسم والرصيد\nالمحفظة والإشعارات', COLORS.identity);
  const side = flowBox(1000, bandY[4], 260, 120, 'مساندة', 'grants · copy\nutils · document-prefs', COLORS.side);
  elements.push(...sess.elements, ...ident.elements, ...shell.elements, ...side.elements);
  elements.push(
    arrow(0, 0, [[sess.x + sess.w, sess.y + 60], [ident.x, ident.y + 60]], { stroke: '#f08c00' }),
    arrow(0, 0, [[ident.x + ident.w, ident.y + 60], [shell.x, shell.y + 60]], { stroke: '#f08c00' }),
  );

  // Legend
  elements.push(
    textEl(
      40,
      bandY[4] + 150,
      'أسطورة: أزرق=سياق · أخضر=جلب/كتابة · أحمر=خطأ · كهرماني=هوية · رمادي=مساندة',
      { fontSize: 12, align: 'left', width: 900, stroke: '#495057' },
    ),
  );

  return document(elements);
}

mkdirSync(__dirname, { recursive: true });
const treePath = join(__dirname, 'web-components-tree.excalidraw');
const flowPath = join(__dirname, 'web-state-dataflow.excalidraw');
const treeDoc = buildTreeBoard();
const flowDoc = buildFlowBoard();
writeFileSync(treePath, JSON.stringify(treeDoc, null, 2));
writeFileSync(flowPath, JSON.stringify(flowDoc, null, 2));

console.log(`Wrote ${treePath}`);
console.log(`Wrote ${flowPath}`);
console.log(`Catalogue files: ${CATALOGUE.length}`);
console.log(`Tree elements: ${treeDoc.elements.length}`);
console.log(`Flow elements: ${flowDoc.elements.length}`);
