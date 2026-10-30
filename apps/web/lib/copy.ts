export const locales = ['ar', 'en', 'he'] as const;
export type Locale = (typeof locales)[number];

export type Copy = {
  brand: string;
  brandSub: string;
  language: string;
  themeToDark: string;
  themeToLight: string;
  openMenu: string;
  closeMenu: string;
  notices: string;
  noNotices: string;
  goodMorning: string;
  goodAfternoon: string;
  goodEvening: string;
  searchPlaceholder: string;
  searchEmpty: string;
  noticeTask: string;
  noticeReply: string;
  collapse: string;
  expand: string;
  loginKicker: string;
  loginTitle: string;
  loginLede: string;
  loginName: string;
  password: string;
  signIn: string;
  passwordKicker: string;
  passwordTitle: string;
  passwordLede: string;
  currentPassword: string;
  newPassword: string;
  save: string;
  cancel: string;
  verifyKicker: string;
  enrollTitle: string;
  codeTitle: string;
  enrollLede: string;
  codeLede: string;
  code: string;
  confirm: string;
  settingsKicker: string;
  settingsTitle: string;
  settingsLede: string;
  account: string;
  nickname: string;
  saveNickname: string;
  email: string;
  saveEmail: string;
  phone: string;
  savePhone: string;
  passwordSection: string;
  changePassword: string;
  twoFactor: string;
  twoFactorIdle: string;
  enableTwoFactor: string;
  enrollHint: string;
  confirmEnable: string;
  sessions: string;
  currentSession: string;
  endSession: string;
  savedNickname: string;
  savedEmail: string;
  savedPhone: string;
  savedPassword: string;
  enabledTwoFactor: string;
  logout: string;
  accountSettings: string;
  navAccount: string;
  navOffice: string;
  navOps: string;
  navBranch: string;
  navWallets: string;
  navPlans: string;
  navNumbers: string;
  navProviders: string;
  navTasks: string;
  navStaff: string;
  navUsers: string;
  navRoles: string;
  rolesTitle: string;
  rolesLede: string;
  grantRead: string;
  grantEdit: string;
  grantEnter: string;
  permissions: string;
  navReports: string;
  usersTitle: string;
  usersLede: string;
  freezeAccount: string;
  restoreAccount: string;
  deleteAccount: string;
  enterAccount: string;
  returnAccount: string;
  frozen: string;
  accountOpen: string;
  company: string;
  linesCount: string;
  reportProviders: string;
  reportProvidersLede: string;
  reportConsumption: string;
  reportConsumptionLede: string;
  reportFunding: string;
  reportFundingLede: string;
  reportTasks: string;
  reportTasksLede: string;
  reportNumbers: string;
  reportNumbersLede: string;
  reportOperations: string;
  reportOperationsLede: string;
  lockedHint: string;
  mainNav: string;
  userMenu: string;
  balance: string;
  ceiling: string;
  amount: string;
  note: string;
  fund: string;
  funded: string;
  selfFund: string;
  layer: string;
  parent: string;
  accountName: string;
  openAccount: string;
  transfer: string;
  role: string;
  staffAccount: string;
  layerBranch: string;
  layerMain: string;
  layerAgent: string;
  layerPos: string;
  walletsTitle: string;
  walletsLede: string;
  plansTitle: string;
  plansLede: string;
  yourPrice: string;
  branchCost: string;
  mainPrice: string;
  agentPrice: string;
  posPrice: string;
  subscriberPrice: string;
  provider: string;
  numbersTitle: string;
  numbersLede: string;
  numbersPosLede: string;
  activateLine: string;
  esim: string;
  iccid: string;
  outcome: string;
  success: string;
  failure: string;
  charge: string;
  disconnect: string;
  freeze: string;
  unfreeze: string;
  switchTo: string;
  noLines: string;
  pointOfSale: string;
  appliedNow: string;
  sentToBranch: string;
  providersTitle: string;
  providersLede: string;
  automatic: string;
  manual: string;
  stopped: string;
  packageLive: string;
  chainTab: string;
  offersTab: string;
  runTab: string;
  tasksTitle: string;
  tasksLede: string;
  take: string;
  release: string;
  complete: string;
  reject: string;
  cancelTask: string;
  reason: string;
  pending: string;
  working: string;
  done: string;
  cancelled: string;
  noTasks: string;
  staffTitle: string;
  staffLede: string;
  reportsTitle: string;
  reportsLede: string;
  when: string;
  actedBy: string;
  movement: string;
  noMovements: string;
  actActivate: string;
  actCharge: string;
  actDisconnect: string;
  actFreeze: string;
  actSwitch: string;
  lineActive: string;
  lineFrozen: string;
  lineDisconnected: string;
  packageName: string;
  number: string;
  status: string;
  homeTitle: string;
  morning: string;
  evening: string;
  quickAccess: string;
  activeLines: string;
  inactiveLines: string;
  lastOps: string;
  board: string;
  noAnnouncements: string;
  postAnnouncement: string;
  announcementHint: string;
  announcementText: string;
  shortcuts: string;
  available: string;
  noCeiling: string;
  walletMenu: string;
  posted: string;
  navOperations: string;
  navAccounting: string;
  navAudit: string;
  accountingLede: string;
  packagePrice: string;
  join: string;
  backCompanies: string;
  serial: string;
  lineNumber: string;
  balanceBefore: string;
  balanceAfter: string;
  direction: string;
  kind: string;
  from: string;
  to: string;
  allRows: string;
  increase: string;
  decrease: string;
  operationsLede: string;
  auditLede: string;
  auditProviderLede: string;
  tabCompanies: string;
  tabPackages: string;
  tabSubscribe: string;
  plansPosLede: string;
  companyImage: string;
  loading: string;
  doorsTitle: string;
  doorsLede: string;
  doorBranch: string;
  doorMain: string;
  doorAgent: string;
  doorPos: string;
  filters: string;
  price: string;
  clearFilters: string;
  numberSearch: string;
  noMatches: string;
  lineCard: string;
  lineOps: string;
  lineDetails: string;
  lineLog: string;
  started: string;
  noHistory: string;
  extend: string;
  endsOn: string;
  updateNumber: string;
  swapSim: string;
};

export const copy: Record<Locale, Copy> = {
  ar: {
    brand: 'سمايل سيم',
    brandSub: 'مكتب البيع بالجملة',
    language: 'اللغة',
    themeToDark: 'تفعيل الوضع الداكن',
    themeToLight: 'تفعيل الوضع الفاتح',
    openMenu: 'فتح القائمة',
    closeMenu: 'إغلاق',
    notices: 'الإشعارات',
    noNotices: 'لا إشعارات',
    goodMorning: 'صباح الخير',
    goodAfternoon: 'مساء الخير',
    goodEvening: 'مساء الخير',
    searchPlaceholder: 'ابحث عن رقم أو حساب…',
    searchEmpty: 'لا نتائج',
    noticeTask: 'مهمة جديدة',
    noticeReply: 'رد على مهمة',
    collapse: 'طي القائمة',
    expand: 'توسيع القائمة',
    loginKicker: 'الدخول',
    loginTitle: 'تسجيل الدخول',
    loginLede: 'أدخل بيانات حسابك للمتابعة.',
    loginName: 'اسم الدخول',
    password: 'كلمة السر',
    signIn: 'دخول',
    passwordKicker: 'كلمة السر',
    passwordTitle: 'تغيير كلمة السر',
    passwordLede: 'اختر كلمة سر جديدة قبل المتابعة.',
    currentPassword: 'كلمة السر الحالية',
    newPassword: 'كلمة السر الجديدة',
    save: 'حفظ',
    cancel: 'إلغاء',
    verifyKicker: 'التحقق',
    enrollTitle: 'تفعيل التحقق بخطوتين',
    codeTitle: 'رمز التحقق',
    enrollLede: 'أضف الرابط التالي إلى تطبيق المصادقة ثم أدخل الرمز.',
    codeLede: 'أدخل الرمز من تطبيق المصادقة.',
    code: 'الرمز',
    confirm: 'تأكيد',
    settingsKicker: 'الحساب',
    settingsTitle: 'الملف الشخصي',
    settingsLede: 'اسمك الظاهر، ووسائل الوصول، والجلسات المفتوحة.',
    account: 'الحساب',
    nickname: 'النيك نيم',
    saveNickname: 'حفظ النيك نيم',
    email: 'البريد',
    saveEmail: 'حفظ البريد',
    phone: 'الهاتف',
    savePhone: 'حفظ الهاتف',
    passwordSection: 'كلمة السر',
    changePassword: 'تغيير كلمة السر',
    twoFactor: 'التحقق بخطوتين',
    twoFactorIdle: 'رمز من تطبيق المصادقة عند كل دخول.',
    enableTwoFactor: 'تفعيل التحقق بخطوتين',
    enrollHint: 'أضف الرابط التالي إلى تطبيق المصادقة ثم أدخل الرمز.',
    confirmEnable: 'تأكيد التفعيل',
    sessions: 'الجلسات',
    currentSession: 'الجلسة الحالية',
    endSession: 'إنهاء',
    savedNickname: 'تم حفظ النيك نيم',
    savedEmail: 'تم حفظ البريد',
    savedPhone: 'تم حفظ الهاتف',
    savedPassword: 'تم تغيير كلمة السر',
    enabledTwoFactor: 'تم تفعيل التحقق بخطوتين',
    logout: 'تسجيل الخروج',
    accountSettings: 'الملف الشخصي',
    navAccount: 'الحساب',
    navOffice: 'المكتب',
    navOps: 'التشغيل',
    navBranch: 'الفرع',
    navWallets: 'المحافظ',
    navPlans: 'الرزم',
    navNumbers: 'الأرقام',
    navProviders: 'المزودون',
    navTasks: 'المهام',
    navStaff: 'الموظفون',
    navUsers: 'المستخدمون',
    navRoles: 'الأدوار',
    rolesTitle: 'الأدوار',
    rolesLede: 'صلاحيات موظفي الفرع. تعديل الدور لا يغيّر صفحة المستخدمين.',
    grantRead: 'قراءة',
    grantEdit: 'تعديل',
    grantEnter: 'دخول الحسابات',
    permissions: 'الصلاحيات',
    navReports: 'التقارير',
    usersTitle: 'المستخدمون',
    usersLede: 'حسابات السلسلة ومحافظها. من الإدارة يُموَّل أي حساب، بما فيه نقطة البيع.',
    freezeAccount: 'تجميد',
    restoreAccount: 'إعادة',
    deleteAccount: 'حذف',
    enterAccount: 'دخول',
    returnAccount: 'رجوع لحسابي',
    frozen: 'مجمّد',
    accountOpen: 'يعمل',
    company: 'الشركة',
    linesCount: 'الأرقام',
    reportProviders: 'تقارير المزودين',
    reportProvidersLede: 'كل حزمة وعدد الأرقام التي تعمل عليها.',
    reportConsumption: 'تقارير استهلاك الرصيد',
    reportConsumptionLede: 'كل حركة رصيد في النظام.',
    reportFunding: 'تقارير شحن الرصيد',
    reportFundingLede: 'عمليات التمويل التي غذّت المحافظ.',
    reportTasks: 'تقارير المهام',
    reportTasksLede: 'المهام وحالتها ومن أنجزها.',
    reportNumbers: 'تقارير الأرقام',
    reportNumbersLede: 'الأرقام وحالتها والحزمة التي عليها.',
    reportOperations: 'تقارير العمليات',
    reportOperationsLede: 'التفعيل والشحن والفصل والتجميد وتحويل الحزمة.',
    lockedHint: 'هذا القسم لم يُفتح بعد.',
    mainNav: 'أقسام المكتب',
    userMenu: 'قائمة الحساب',
    balance: 'الرصيد',
    ceiling: 'السقف',
    amount: 'المبلغ',
    note: 'ملاحظة',
    fund: 'تمويل',
    funded: 'تم التمويل',
    selfFund: 'تمويل الحساب',
    layer: 'الطبقة',
    parent: 'يتبع',
    accountName: 'الحساب',
    openAccount: 'حساب جديد',
    transfer: 'نقل',
    role: 'الدور',
    staffAccount: 'موظف',
    layerBranch: 'فرع',
    layerMain: 'وكيل رئيسي',
    layerAgent: 'وكيل',
    layerPos: 'نقطة بيع',
    walletsTitle: 'المحافظ',
    walletsLede: 'الرصيد والسقف. التمويل ينزل طبقة واحدة، ومحفظة الفرع تُملأ بملاحظة.',
    plansTitle: 'الرزم',
    plansLede: 'سعر بيعك هو سعر شراء الطبقة التي تحتك، ولا ينزل عن سعرك.',
    yourPrice: 'سعرك',
    branchCost: 'تكلفة الفرع',
    mainPrice: 'سعر الرئيسي',
    agentPrice: 'سعر الوكيل',
    posPrice: 'سعر النقطة',
    subscriberPrice: 'سعر المشترك',
    provider: 'المزود',
    numbersTitle: 'الأرقام',
    numbersLede: 'التفعيل والشحن على محفظة نقطة البيع. اختر نتيجة المزود قبل التنفيذ.',
    numbersPosLede: 'خطوطك. التمديد والتفعيل والفصل وتبديل الرزمة تتم من هنا.',
    activateLine: 'تفعيل رقم',
    esim: 'شريحة إلكترونية',
    iccid: 'رقم الشريحة',
    outcome: 'نتيجة المزود',
    success: 'نجاح',
    failure: 'فشل',
    charge: 'شحن',
    disconnect: 'فصل',
    freeze: 'تجميد',
    unfreeze: 'فك تجميد',
    switchTo: 'تحويل إلى',
    noLines: 'لا أرقام بعد.',
    pointOfSale: 'نقطة البيع',
    appliedNow: 'تم التنفيذ وخصم الرصيد.',
    sentToBranch: 'أُرسلت مهمة للفرع. لم يُخصم شيء.',
    providersTitle: 'المزودون',
    providersLede: 'اختر المزود، ثم الرزمة.',
    automatic: 'مباشر',
    manual: 'مهمة فرع',
    stopped: 'متوقف',
    packageLive: 'الحالة عند الكل',
    chainTab: 'السلسلة',
    offersTab: 'المخصصون',
    runTab: 'التشغيل',
    tasksTitle: 'المهام',
    tasksLede: 'ما فشل أو ليس مباشراً يبقى هنا حتى يكتمل أو يُلغى. لا خصم قبل الاكتمال.',
    take: 'استلام',
    release: 'إرجاع',
    complete: 'إتمام',
    reject: 'رفض',
    cancelTask: 'إلغاء',
    reason: 'السبب',
    pending: 'قيد المعالجة',
    working: 'تحت المعالجة',
    done: 'تم المعالجة',
    cancelled: 'ملغاة',
    noTasks: 'لا مهام.',
    staffTitle: 'الموظفون',
    staffLede: 'سلسلة الحسابات التي تراها: أنت ومن تحتك. الأدوار المفصّلة لم تُبنَ بعد.',
    reportsTitle: 'التقارير',
    reportsLede: 'حركات المحافظ. هذا القسم للفرع فقط.',
    when: 'الوقت',
    actedBy: 'من قام بالعملية',
    movement: 'الحركة',
    noMovements: 'لا حركات بعد.',
    actActivate: 'تفعيل',
    actCharge: 'شحن',
    actDisconnect: 'فصل',
    actFreeze: 'تجميد',
    actSwitch: 'تبديل الرزمة',
    lineActive: 'يعمل',
    lineFrozen: 'مجمّد',
    lineDisconnected: 'مفصول',
    packageName: 'الرزمة',
    number: 'الرقم',
    status: 'الحالة',
    homeTitle: 'الصفحة الرئيسية',
    morning: 'صباح الخير',
    evening: 'مساء الخير',
    quickAccess: 'وصول سريع',
    activeLines: 'اشتراكات فعالة',
    inactiveLines: 'اشتراكات غير فعالة',
    lastOps: 'آخر العمليات',
    board: 'لوحة الإعلانات',
    noAnnouncements: 'لا إعلانات.',
    postAnnouncement: 'نشر',
    announcementHint: 'يصل الإعلان لمن تحتك في التسلسل.',
    announcementText: 'نص الإعلان',
    shortcuts: 'اختصارات',
    available: 'المتاح',
    noCeiling: 'بلا حد',
    walletMenu: 'تفاصيل المحفظة',
    posted: 'تم نشر الإعلان',
    navOperations: 'العمليات',
    navAccounting: 'المحاسبة',
    navAudit: 'سجل التدقيق',
    accountingLede: 'كشف للزبون: الرقم والشركة والرزمة وسعرها، والرصيد قبل العملية وبعدها.',
    packagePrice: 'سعر الرزمة',
    join: 'انضمام',
    backCompanies: 'الرجوع للشركات',
    serial: 'رقم السيريال',
    lineNumber: 'رقم الخط',
    balanceBefore: 'الرصيد قبل',
    balanceAfter: 'الرصيد بعد',
    direction: 'الاتجاه',
    kind: 'النوع',
    from: 'من',
    to: 'إلى',
    allRows: 'الكل',
    increase: 'زيادة',
    decrease: 'نقص',
    operationsLede: 'خصم الرصيد وزيادته على عمليات الخط: التفعيل والشحن وما يرجع من فرق الحزمة.',
    auditLede: 'عمليات الأرقام على هذا الحساب.',
    auditProviderLede: 'عمليات الأرقام عند المزودين. لاحقاً نحدد لكل مزود طريقة تعامله مع كل عملية.',
    tabCompanies: 'الشركات',
    tabPackages: 'الرزم',
    tabSubscribe: 'تفاصيل الاشتراك',
    plansPosLede: 'اختر الشركة، ثم الرزمة، ثم أدخل تفاصيل الشريحة.',
    companyImage: 'صورة الشركة',
    loading: 'جاري التحميل',
    doorsTitle: 'اختر المدخل',
    doorsLede: 'كل طبقة تدخل من بابها، والحساب الذي لا يخص الباب يُرفض.',
    doorBranch: 'الإدارة',
    doorMain: 'الوكيل الرئيسي',
    doorAgent: 'الوكيل',
    doorPos: 'نقطة البيع',
    filters: 'الفلاتر',
    price: 'السعر',
    clearFilters: 'مسح',
    numberSearch: 'الرقم',
    noMatches: 'لا نتائج لهذا التصفية',
    lineCard: 'بطاقة الرقم',
    lineOps: 'العمليات',
    lineDetails: 'التفاصيل',
    lineLog: 'السجل',
    started: 'تاريخ البداية',
    noHistory: 'لا سجل لهذا الرقم',
    extend: 'تمديد',
    endsOn: 'انتهاء الحزمة',
    updateNumber: 'تحديث الرقم',
    swapSim: 'تبديل الشريحة',
  },
  en: {
    brand: 'Smile SIM',
    brandSub: 'Wholesale desk',
    language: 'Language',
    themeToDark: 'Switch to dark',
    themeToLight: 'Switch to light',
    openMenu: 'Open menu',
    closeMenu: 'Close',
    notices: 'Notices',
    noNotices: 'No notices',
    goodMorning: 'Good morning',
    goodAfternoon: 'Good afternoon',
    goodEvening: 'Good evening',
    searchPlaceholder: 'Search for a number or account…',
    searchEmpty: 'No results',
    noticeTask: 'New task',
    noticeReply: 'Task reply',
    collapse: 'Collapse menu',
    expand: 'Expand menu',
    loginKicker: 'Sign in',
    loginTitle: 'Sign in',
    loginLede: 'Enter your account details to continue.',
    loginName: 'Login name',
    password: 'Password',
    signIn: 'Sign in',
    passwordKicker: 'Password',
    passwordTitle: 'Change password',
    passwordLede: 'Choose a new password before continuing.',
    currentPassword: 'Current password',
    newPassword: 'New password',
    save: 'Save',
    cancel: 'Cancel',
    verifyKicker: 'Verification',
    enrollTitle: 'Turn on two-factor',
    codeTitle: 'Verification code',
    enrollLede: 'Add this link to your authenticator, then enter the code.',
    codeLede: 'Enter the code from your authenticator.',
    code: 'Code',
    confirm: 'Confirm',
    settingsKicker: 'Account',
    settingsTitle: 'Profile',
    settingsLede: 'Your display name, contact details, and open sessions.',
    account: 'Account',
    nickname: 'Nickname',
    saveNickname: 'Save nickname',
    email: 'Email',
    saveEmail: 'Save email',
    phone: 'Phone',
    savePhone: 'Save phone',
    passwordSection: 'Password',
    changePassword: 'Change password',
    twoFactor: 'Two-factor',
    twoFactorIdle: 'An authenticator code on each sign-in.',
    enableTwoFactor: 'Turn on two-factor',
    enrollHint: 'Add this link to your authenticator, then enter the code.',
    confirmEnable: 'Confirm setup',
    sessions: 'Sessions',
    currentSession: 'Current session',
    endSession: 'End',
    savedNickname: 'Nickname saved',
    savedEmail: 'Email saved',
    savedPhone: 'Phone saved',
    savedPassword: 'Password changed',
    enabledTwoFactor: 'Two-factor is on',
    logout: 'Sign out',
    accountSettings: 'Profile',
    navAccount: 'Account',
    navOffice: 'Desk',
    navOps: 'Operations',
    navBranch: 'Branch',
    navWallets: 'Wallets',
    navPlans: 'Packages',
    navNumbers: 'Numbers',
    navProviders: 'Providers',
    navTasks: 'Tasks',
    navStaff: 'Staff',
    navUsers: 'Users',
    navRoles: 'Roles',
    rolesTitle: 'Roles',
    rolesLede: 'Branch staff permissions. Editing a role stays off the users page.',
    grantRead: 'Read',
    grantEdit: 'Edit',
    grantEnter: 'Enter accounts',
    permissions: 'Permissions',
    navReports: 'Reports',
    usersTitle: 'Users',
    usersLede: 'Chain accounts and their wallets. The branch can fund any account, including a point of sale.',
    freezeAccount: 'Freeze',
    restoreAccount: 'Restore',
    deleteAccount: 'Delete',
    enterAccount: 'Enter',
    returnAccount: 'Back to my account',
    frozen: 'Frozen',
    accountOpen: 'Active',
    company: 'Company',
    linesCount: 'Numbers',
    reportProviders: 'Provider reports',
    reportProvidersLede: 'Each package and how many numbers use it.',
    reportConsumption: 'Balance use',
    reportConsumptionLede: 'Every balance movement in the system.',
    reportFunding: 'Balance top-ups',
    reportFundingLede: 'The funding that filled the wallets.',
    reportTasks: 'Task reports',
    reportTasksLede: 'Tasks, their state, and who finished them.',
    reportNumbers: 'Number reports',
    reportNumbersLede: 'Numbers, their state, and their package.',
    reportOperations: 'Operation reports',
    reportOperationsLede: 'Activation, charge, disconnect, freeze, and package switch.',
    lockedHint: 'This section is not open yet.',
    mainNav: 'Desk sections',
    userMenu: 'Account menu',
    balance: 'Balance',
    ceiling: 'Ceiling',
    amount: 'Amount',
    note: 'Note',
    fund: 'Fund',
    funded: 'Funded',
    selfFund: 'Own funding',
    layer: 'Layer',
    parent: 'Reports to',
    accountName: 'Account',
    openAccount: 'New account',
    transfer: 'Transfer',
    role: 'Role',
    staffAccount: 'Employee',
    layerBranch: 'Branch',
    layerMain: 'Main agent',
    layerAgent: 'Agent',
    layerPos: 'Point of sale',
    walletsTitle: 'Wallets',
    walletsLede: 'Balance and ceiling. Funding moves one layer down. The branch wallet is filled with a note.',
    plansTitle: 'Plans',
    plansLede: 'Your sell price is the buy price of the layer below, and it cannot go under your own price.',
    yourPrice: 'Your price',
    branchCost: 'Branch cost',
    mainPrice: 'Main price',
    agentPrice: 'Agent price',
    posPrice: 'POS price',
    subscriberPrice: 'Subscriber price',
    provider: 'Provider',
    numbersTitle: 'Numbers',
    numbersLede: 'Activation and charge use the point-of-sale wallet. Choose the provider result before you run it.',
    numbersPosLede: 'Your lines. Extend, activate, disconnect, and package switch happen here.',
    activateLine: 'Activate a number',
    esim: 'eSIM',
    iccid: 'ICCID',
    outcome: 'Provider result',
    success: 'Success',
    failure: 'Failure',
    charge: 'Charge',
    disconnect: 'Disconnect',
    freeze: 'Freeze',
    unfreeze: 'Unfreeze',
    switchTo: 'Switch to',
    noLines: 'No numbers yet.',
    pointOfSale: 'Point of sale',
    appliedNow: 'Done. The wallet was charged.',
    sentToBranch: 'Sent to the branch. Nothing was deducted.',
    providersTitle: 'Providers',
    providersLede: 'Open a provider, then a package.',
    automatic: 'Immediate',
    manual: 'Branch task',
    stopped: 'Stopped',
    packageLive: 'Status for everyone',
    chainTab: 'Chain',
    offersTab: 'Special prices',
    runTab: 'Running',
    tasksTitle: 'Tasks',
    tasksLede: 'A failure, or an operation that is not immediate, stays here until it is finished or cancelled. Nothing is deducted before completion.',
    take: 'Take',
    release: 'Release',
    complete: 'Complete',
    reject: 'Reject',
    cancelTask: 'Cancel',
    reason: 'Reason',
    pending: 'Pending',
    working: 'In progress',
    done: 'Done',
    cancelled: 'Cancelled',
    noTasks: 'No tasks.',
    staffTitle: 'Staff',
    staffLede: 'The account chain you can see: you and the accounts under you. Detailed roles are not built yet.',
    reportsTitle: 'Reports',
    reportsLede: 'Wallet movements. This section is for the branch only.',
    when: 'Time',
    actedBy: 'Done by',
    movement: 'Movement',
    noMovements: 'No movements yet.',
    actActivate: 'Activate',
    actCharge: 'Charge',
    actDisconnect: 'Disconnect',
    actFreeze: 'Freeze',
    actSwitch: 'Switch package',
    lineActive: 'Active',
    lineFrozen: 'Frozen',
    lineDisconnected: 'Disconnected',
    packageName: 'Plan',
    number: 'Number',
    status: 'Status',
    homeTitle: 'Home',
    morning: 'Good morning',
    evening: 'Good evening',
    quickAccess: 'Quick access',
    activeLines: 'Active subscriptions',
    inactiveLines: 'Inactive subscriptions',
    lastOps: 'Latest operations',
    board: 'Announcements',
    noAnnouncements: 'No announcements.',
    postAnnouncement: 'Publish',
    announcementHint: 'The notice reaches the accounts under you.',
    announcementText: 'Announcement',
    shortcuts: 'Shortcuts',
    available: 'Available',
    noCeiling: 'No ceiling',
    walletMenu: 'Wallet details',
    posted: 'Announcement published',
    navOperations: 'Operations',
    navAccounting: 'Accounting',
    navAudit: 'Audit log',
    accountingLede: 'Customer statement: number, company, package, package price, and the balance before and after.',
    packagePrice: 'Package price',
    join: 'Join',
    backCompanies: 'Back to companies',
    serial: 'Serial',
    lineNumber: 'Line number',
    balanceBefore: 'Balance before',
    balanceAfter: 'Balance after',
    direction: 'Direction',
    kind: 'Kind',
    from: 'From',
    to: 'To',
    allRows: 'All',
    increase: 'Increase',
    decrease: 'Decrease',
    operationsLede: 'Balance leaving and returning on line operations.',
    auditLede: 'Number operations on this account.',
    auditProviderLede: 'Number operations sent to providers. Later, each provider gets its own way to handle each operation.',
    tabCompanies: 'Companies',
    tabPackages: 'Packages',
    tabSubscribe: 'Subscription details',
    plansPosLede: 'Choose the company, then the package, then enter the SIM details.',
    companyImage: 'Company image',
    loading: 'Loading',
    doorsTitle: 'Choose a door',
    doorsLede: 'Each layer signs in through its own door. An account from another layer is refused.',
    doorBranch: 'Management',
    doorMain: 'Main agent',
    doorAgent: 'Agent',
    doorPos: 'Point of sale',
    filters: 'Filters',
    price: 'Price',
    clearFilters: 'Clear',
    numberSearch: 'Number',
    noMatches: 'No matching lines',
    lineCard: 'Number card',
    lineOps: 'Operations',
    lineDetails: 'Details',
    lineLog: 'Log',
    started: 'Started',
    noHistory: 'No history for this number',
    extend: 'Extend',
    endsOn: 'Package ends',
    updateNumber: 'Update number',
    swapSim: 'Replace SIM',
  },
  he: {
    brand: 'סמייל סים',
    brandSub: 'משרד סיטונאות',
    language: 'שפה',
    themeToDark: 'מעבר למצב כהה',
    themeToLight: 'מעבר למצב בהיר',
    openMenu: 'פתיחת התפריט',
    closeMenu: 'סגירה',
    notices: 'התראות',
    noNotices: 'אין התראות',
    goodMorning: 'בוקר טוב',
    goodAfternoon: 'צהריים טובים',
    goodEvening: 'ערב טוב',
    searchPlaceholder: 'חיפוש מספר או חשבון…',
    searchEmpty: 'אין תוצאות',
    noticeTask: 'משימה חדשה',
    noticeReply: 'תשובה למשימה',
    collapse: 'כיווץ התפריט',
    expand: 'הרחבת התפריט',
    loginKicker: 'כניסה',
    loginTitle: 'התחברות',
    loginLede: 'הזן את פרטי החשבון כדי להמשיך.',
    loginName: 'שם כניסה',
    password: 'סיסמה',
    signIn: 'כניסה',
    passwordKicker: 'סיסמה',
    passwordTitle: 'שינוי סיסמה',
    passwordLede: 'בחר סיסמה חדשה לפני ההמשך.',
    currentPassword: 'סיסמה נוכחית',
    newPassword: 'סיסמה חדשה',
    save: 'שמירה',
    cancel: 'ביטול',
    verifyKicker: 'אימות',
    enrollTitle: 'הפעלת אימות דו-שלבי',
    codeTitle: 'קוד אימות',
    enrollLede: 'הוסף את הקישור לאפליקציית האימות ואז הזן את הקוד.',
    codeLede: 'הזן את הקוד מאפליקציית האימות.',
    code: 'קוד',
    confirm: 'אישור',
    settingsKicker: 'חשבון',
    settingsTitle: 'פרופיל',
    settingsLede: 'השם המוצג, פרטי הקשר, וההפעלות הפתוחות.',
    account: 'חשבון',
    nickname: 'כינוי',
    saveNickname: 'שמירת כינוי',
    email: 'דוא״ל',
    saveEmail: 'שמירת דוא״ל',
    phone: 'טלפון',
    savePhone: 'שמירת טלפון',
    passwordSection: 'סיסמה',
    changePassword: 'שינוי סיסמה',
    twoFactor: 'אימות דו-שלבי',
    twoFactorIdle: 'קוד מאפליקציית האימות בכל כניסה.',
    enableTwoFactor: 'הפעלת אימות דו-שלבי',
    enrollHint: 'הוסף את הקישור לאפליקציית האימות ואז הזן את הקוד.',
    confirmEnable: 'אישור ההפעלה',
    sessions: 'הפעלות',
    currentSession: 'ההפעלה הנוכחית',
    endSession: 'סיום',
    savedNickname: 'הכינוי נשמר',
    savedEmail: 'הדוא״ל נשמר',
    savedPhone: 'הטלפון נשמר',
    savedPassword: 'הסיסמה שונתה',
    enabledTwoFactor: 'האימות הדו-שלבי הופעל',
    logout: 'יציאה',
    accountSettings: 'פרופיל',
    navAccount: 'חשבון',
    navOffice: 'המשרד',
    navOps: 'תפעול',
    navBranch: 'הסניף',
    navWallets: 'ארנקים',
    navPlans: 'חבילות',
    navNumbers: 'מספרים',
    navProviders: 'ספקים',
    navTasks: 'משימות',
    navStaff: 'עובדים',
    navUsers: 'משתמשים',
    navRoles: 'תפקידים',
    rolesTitle: 'תפקידים',
    rolesLede: 'הרשאות עובדי הסניף. עריכת תפקיד לא נוגעת בדף המשתמשים.',
    grantRead: 'קריאה',
    grantEdit: 'עריכה',
    grantEnter: 'כניסה לחשבונות',
    permissions: 'הרשאות',
    navReports: 'דוחות',
    usersTitle: 'משתמשים',
    usersLede: 'חשבונות השרשרת והארנקים שלהם. הסניף מממן כל חשבון, כולל נקודת מכירה.',
    freezeAccount: 'הקפאה',
    restoreAccount: 'שחזור',
    deleteAccount: 'מחיקה',
    enterAccount: 'כניסה',
    returnAccount: 'חזרה לחשבון שלי',
    frozen: 'מוקפא',
    accountOpen: 'פעיל',
    company: 'חברה',
    linesCount: 'מספרים',
    reportProviders: 'דוחות ספקים',
    reportProvidersLede: 'כל חבילה וכמה מספרים פועלים עליה.',
    reportConsumption: 'צריכת יתרה',
    reportConsumptionLede: 'כל תנועת יתרה במערכת.',
    reportFunding: 'טעינת יתרה',
    reportFundingLede: 'המימון שמילא את הארנקים.',
    reportTasks: 'דוחות משימות',
    reportTasksLede: 'משימות, המצב שלהן, ומי השלים אותן.',
    reportNumbers: 'דוחות מספרים',
    reportNumbersLede: 'מספרים, המצב שלהם, והחבילה שעליהם.',
    reportOperations: 'דוחות פעולות',
    reportOperationsLede: 'הפעלה, טעינה, ניתוק, הקפאה, והחלפת חבילה.',
    lockedHint: 'המדור הזה עוד לא נפתח.',
    mainNav: 'מדורי המשרד',
    userMenu: 'תפריט החשבון',
    balance: 'יתרה',
    ceiling: 'תקרה',
    amount: 'סכום',
    note: 'הערה',
    fund: 'מימון',
    funded: 'מומן',
    selfFund: 'מימון עצמי',
    layer: 'שכבה',
    parent: 'כפוף ל',
    accountName: 'חשבון',
    openAccount: 'חשבון חדש',
    transfer: 'העברה',
    role: 'תפקיד',
    staffAccount: 'עובד',
    layerBranch: 'סניף',
    layerMain: 'סוכן ראשי',
    layerAgent: 'סוכן',
    layerPos: 'נקודת מכירה',
    walletsTitle: 'ארנקים',
    walletsLede: 'יתרה ותקרה. המימון יורד שכבה אחת. ארנק הסניף מתמלא עם הערה.',
    plansTitle: 'חבילות',
    plansLede: 'מחיר המכירה שלך הוא מחיר הקנייה של השכבה שמתחת, והוא לא יורד ממחירך.',
    yourPrice: 'המחיר שלך',
    branchCost: 'עלות הסניף',
    mainPrice: 'מחיר הראשי',
    agentPrice: 'מחיר הסוכן',
    posPrice: 'מחיר הנקודה',
    subscriberPrice: 'מחיר המנוי',
    provider: 'ספק',
    numbersTitle: 'מספרים',
    numbersLede: 'הפעלה וטעינה יורדות מארנק נקודת המכירה. בחר את תוצאת הספק לפני הביצוע.',
    numbersPosLede: 'הקווים שלך. הארכה, הפעלה, ניתוק והחלפת חבילה מכאן.',
    activateLine: 'הפעלת מספר',
    esim: 'סים אלקטרוני',
    iccid: 'מספר הסים',
    outcome: 'תוצאת הספק',
    success: 'הצלחה',
    failure: 'כישלון',
    charge: 'טעינה',
    disconnect: 'ניתוק',
    freeze: 'הקפאה',
    unfreeze: 'ביטול הקפאה',
    switchTo: 'מעבר אל',
    noLines: 'אין מספרים עדיין.',
    pointOfSale: 'נקודת מכירה',
    appliedNow: 'בוצע. הארנק חויב.',
    sentToBranch: 'נשלח לסניף. לא ירד סכום.',
    providersTitle: 'ספקים',
    providersLede: 'ספק, ואז חבילה.',
    automatic: 'מיידי',
    manual: 'משימת סניף',
    stopped: 'מושבת',
    packageLive: 'מצב לכולם',
    chainTab: 'השרשרת',
    offersTab: 'מחירים מיוחדים',
    runTab: 'הפעלה',
    tasksTitle: 'משימות',
    tasksLede: 'כישלון, או פעולה שאינה מיידית, נשאר כאן עד השלמה או ביטול. אין חיוב לפני השלמה.',
    take: 'קבלה',
    release: 'שחרור',
    complete: 'השלמה',
    reject: 'דחייה',
    cancelTask: 'ביטול',
    reason: 'סיבה',
    pending: 'ממתין',
    working: 'בטיפול',
    done: 'הושלם',
    cancelled: 'בוטל',
    noTasks: 'אין משימות.',
    staffTitle: 'עובדים',
    staffLede: 'שרשרת החשבונות שאתה רואה: אתה ומי שתחתך. תפקידים מפורטים עוד לא נבנו.',
    reportsTitle: 'דוחות',
    reportsLede: 'תנועות הארנקים. המדור הזה לסניף בלבד.',
    when: 'זמן',
    actedBy: 'בוצע על ידי',
    movement: 'תנועה',
    noMovements: 'אין תנועות עדיין.',
    actActivate: 'הפעלה',
    actCharge: 'טעינה',
    actDisconnect: 'ניתוק',
    actFreeze: 'הקפאה',
    actSwitch: 'החלפת חבילה',
    lineActive: 'פעיל',
    lineFrozen: 'מוקפא',
    lineDisconnected: 'מנותק',
    packageName: 'חבילה',
    number: 'מספר',
    status: 'מצב',
    homeTitle: 'דף הבית',
    morning: 'בוקר טוב',
    evening: 'ערב טוב',
    quickAccess: 'גישה מהירה',
    activeLines: 'מנויים פעילים',
    inactiveLines: 'מנויים לא פעילים',
    lastOps: 'פעולות אחרונות',
    board: 'לוח מודעות',
    noAnnouncements: 'אין מודעות.',
    postAnnouncement: 'פרסום',
    announcementHint: 'המודעה מגיעה לחשבונות שמתחתך.',
    announcementText: 'נוסח המודעה',
    shortcuts: 'קיצורים',
    available: 'זמין',
    noCeiling: 'ללא תקרה',
    walletMenu: 'פרטי הארנק',
    posted: 'המודעה פורסמה',
    navOperations: 'פעולות',
    navAccounting: 'הנהלת חשבונות',
    navAudit: 'יומן ביקורת',
    accountingLede: 'דף ללקוח: מספר, חברה, חבילה, מחיר החבילה, והיתרה לפני ואחרי.',
    packagePrice: 'מחיר החבילה',
    join: 'הצטרפות',
    backCompanies: 'חזרה לחברות',
    serial: 'מספר סידורי',
    lineNumber: 'מספר קו',
    balanceBefore: 'יתרה לפני',
    balanceAfter: 'יתרה אחרי',
    direction: 'כיוון',
    kind: 'סוג',
    from: 'מ',
    to: 'עד',
    allRows: 'הכל',
    increase: 'עלייה',
    decrease: 'ירידה',
    operationsLede: 'יציאת יתרה וחזרתה בפעולות הקו.',
    auditLede: 'פעולות המספרים בחשבון הזה.',
    auditProviderLede: 'פעולות המספרים אצל הספקים. בהמשך לכל ספק דרך משלו לטפל בכל פעולה.',
    tabCompanies: 'חברות',
    tabPackages: 'חבילות',
    tabSubscribe: 'פרטי המנוי',
    plansPosLede: 'בחר חברה, אחר כך חבילה, ואז פרטי הסים.',
    companyImage: 'תמונת חברה',
    loading: 'טוען',
    doorsTitle: 'בחר כניסה',
    doorsLede: 'כל שכבה נכנסת מהדלת שלה. חשבון משכבה אחרת נדחה.',
    doorBranch: 'הנהלה',
    doorMain: 'סוכן ראשי',
    doorAgent: 'סוכן',
    doorPos: 'נקודת מכירה',
    filters: 'מסננים',
    price: 'מחיר',
    clearFilters: 'ניקוי',
    numberSearch: 'מספר',
    noMatches: 'אין תוצאות',
    lineCard: 'כרטיס מספר',
    lineOps: 'פעולות',
    lineDetails: 'פרטים',
    lineLog: 'יומן',
    started: 'תאריך התחלה',
    noHistory: 'אין היסטוריה למספר הזה',
    extend: 'הארכה',
    endsOn: 'סיום החבילה',
    updateNumber: 'עדכון מספר',
    swapSim: 'החלפת סים',
  },
};

const apiCopy: Record<Exclude<Locale, 'ar'>, Record<string, string>> = {
  en: {
    'بيانات الدخول غير صحيحة': 'The login details are incorrect',
    'الحساب موقوف': 'This account is suspended',
    'محاولات كثيرة. أعد المحاولة بعد قليل': 'Too many attempts. Try again shortly',
    'الرمز غير صحيح': 'The code is incorrect',
    'كلمة السر الحالية غير صحيحة': 'The current password is incorrect',
    'يلزم تسجيل الدخول': 'Sign in to continue',
    'النيك نيم من حرفين إلى أربعين حرفاً': 'Nickname must be 2 to 40 characters',
    'كلمة السر ثمانية أحرف على الأقل': 'Password must be at least 8 characters',
    'تعذّر الاتصال بالخادم': 'Could not reach the server',
    'حدث خطأ': 'Something went wrong',
    'غير مسموح': 'Not allowed',
    'بيانات غير صالحة': 'The details are not valid',
    'الرصيد لا يكفي ضمن السقف': 'The balance is not enough within the ceiling',
    'سعر البيع أقل من المسموح': 'The sell price is below the allowed price',
    'غير موجود': 'Not found',
    'التقارير للفرع فقط': 'Reports are for the branch only',
    'أضف ملاحظة للتمويل': 'Add a note for this funding',
    'لا يُحذف حساب فيه سجل. جمّده.': 'An account with history is not deleted. Freeze it.',
    'الرقم مستخدم': 'This number is already in use',
    'هذا الحساب ليس لهذا المدخل': 'This account is not for this door',
  },
  he: {
    'بيانات الدخول غير صحيحة': 'פרטי הכניסה שגויים',
    'الحساب موقوف': 'החשבון מושעה',
    'محاولات كثيرة. أعد المحاولة بعد قليل': 'יותר מדי ניסיונות. נסה שוב בקרוב',
    'الرمز غير صحيح': 'הקוד שגוי',
    'كلمة السر الحالية غير صحيحة': 'הסיסמה הנוכחית שגויה',
    'يلزم تسجيل الدخول': 'נדרשת התחברות',
    'النيك نيم من حرفين إلى أربعين حرفاً': 'הכינוי חייב להיות בין 2 ל-40 תווים',
    'كلمة السر ثمانية أحرف على الأقل': 'הסיסמה חייבת להכיל לפחות 8 תווים',
    'تعذّر الاتصال بالخادم': 'לא ניתן להתחבר לשרת',
    'حدث خطأ': 'אירעה שגיאה',
    'غير مسموح': 'אין הרשאה',
    'بيانات غير صالحة': 'הפרטים אינם תקינים',
    'الرصيد لا يكفي ضمن السقف': 'היתרה אינה מספיקה בתוך התקרה',
    'سعر البيع أقل من المسموح': 'מחיר המכירה נמוך מהמותר',
    'غير موجود': 'לא נמצא',
    'التقارير للفرع فقط': 'הדוחות לסניף בלבד',
    'أضف ملاحظة للتمويل': 'הוסף הערה למימון',
    'لا يُحذف حساب فيه سجل. جمّده.': 'חשבון עם היסטוריה לא נמחק. הקפא אותו.',
    'الرقم مستخدم': 'המספר כבר בשימוש',
    'هذا الحساب ليس لهذا المدخل': 'החשבון הזה אינו לדלת הזו',
  },
};

export function translateApi(locale: Locale, message: string): string {
  if (locale === 'ar') return message;
  return apiCopy[locale][message] ?? message;
}

export const langLabel: Record<Locale, string> = {
  ar: 'ع',
  en: 'EN',
  he: 'עב',
};

export const langName: Record<Locale, string> = {
  ar: 'العربية',
  en: 'English',
  he: 'עברית',
};
