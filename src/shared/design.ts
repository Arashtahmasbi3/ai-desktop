/**
 * The design contract (Art Board, phase 0).
 *
 * One JSON document is the single source of truth for the board, the build step and the chat: pages, the modules on
 * each page, the edges between pages, and the free-text notes the user writes for the AI. Nothing else is allowed to
 * invent structure — a build reads this and only this.
 *
 * The type is deliberately small and boring: ids are strings, props are a record, and every rule that can be checked
 * without a browser is checked here, so the wizard, the store, the builder and the chat tools all fail the same way.
 */

export type DesignKind = 'website' | 'app'
export type DesignSiteType = 'shop' | 'corporate' | 'personal' | 'education' | 'clinic' | 'restaurant'
export type DesignLocale = 'fa' | 'en'
export type DesignDirection = 'rtl' | 'ltr'
export type PageRole = 'public' | 'auth' | 'admin'
export type EdgeTrigger = 'click' | 'submit' | 'redirect'
export type ModuleFamily =
  | 'layout'
  | 'content'
  | 'commerce'
  | 'auth'
  | 'forms'
  | 'admin'
  | 'system'

export interface DesignTheme {
  /** A token name, never a raw colour in the contract: the builder maps it to CSS variables. */
  brand: string
  font: string
}

/** What the wizard asked and the user answered. Kept in the document so a rebuild can explain itself. */
export interface DesignAnswers {
  kind: DesignKind
  type: DesignSiteType
  needs: string[]
  brand: string
  locale: DesignLocale
  siteName: string
}

export interface DesignModule {
  id: string
  /** A key of {@link MODULE_TYPES}; an unknown key is a validation error, not a guess. */
  type: string
  props: Record<string, unknown>
  /** The user's own words about this module. The AI reads these before anything else. */
  notes?: string
}

export interface DesignPage {
  id: string
  name: string
  path: string
  role: PageRole
  modules: DesignModule[]
}

export interface DesignEdge {
  id: string
  from: string
  to: string
  trigger: EdgeTrigger
}

export interface DesignProject {
  version: 1
  id: string
  name: string
  kind: DesignKind
  type: DesignSiteType
  locale: DesignLocale
  dir: DesignDirection
  theme: DesignTheme
  answers: DesignAnswers
  pages: DesignPage[]
  edges: DesignEdge[]
  createdAt: number
  updatedAt: number
}

/** A list row for the projects screen — no page bodies, so the list stays cheap. */
export interface DesignSummary {
  id: string
  name: string
  kind: DesignKind
  type: DesignSiteType
  pages: number
  updatedAt: number
}

export interface DesignValidation {
  ok: boolean
  problems: string[]
}

/** What a build produced: the Vite project, the one-file preview, the zip, and the file list. */
export interface DesignBuildResult {
  siteDir: string
  previewPath: string
  zipPath: string
  files: string[]
}

/** One row of the version timeline (phase 4). `by` is a VersionAuthor string kept loose for the IPC boundary. */
export interface DesignVersionSummary {
  version: number
  at: number
  by: string
  summary: string
}

export interface ModuleDefinition {
  label: string
  family: ModuleFamily
  defaults: Record<string, unknown>
}

/**
 * The v1 catalogue: 47 module types in 7 families. It is a constant, not a plugin registry, because the builder ships
 * one template per type and a type without a template is a module nothing can render.
 */
export const MODULE_TYPES: Record<string, ModuleDefinition> = {
  // Layout (5)
  navbar: { label: 'نوار بالا', family: 'layout', defaults: { title: 'نام سایت', items: ['خانه', 'محصولات', 'تماس'], cta: 'تماس' } },
  footer: { label: 'پانوشت', family: 'layout', defaults: { text: '© همهٔ حقوق محفوظ است.', columns: 3 } },
  breadcrumb: { label: 'مسیر راهنما', family: 'layout', defaults: { items: ['خانه'] } },
  sidebar_admin: { label: 'منوی مدیریت', family: 'layout', defaults: { items: ['داشبورد', 'محتوا', 'تنظیمات'] } },
  section_container: { label: 'بخش‌بندی', family: 'layout', defaults: { title: 'بخش تازه', columns: 2 } },
  // Content (12)
  hero: { label: 'بخش اصلی', family: 'content', defaults: { title: 'به سایت ما خوش آمدید', subtitle: 'یک توضیح کوتاه', cta: 'شروع کنید' } },
  features: { label: 'ویژگی‌ها', family: 'content', defaults: { title: 'چرا ما؟', items: ['سریع', 'ساده', 'مطمئن'] } },
  about: { label: 'درباره ما', family: 'content', defaults: { title: 'درباره ما', text: 'چند خط دربارهٔ کسب‌وکار شما' } },
  stats: { label: 'آمار', family: 'content', defaults: { items: [{ value: '۱۰۰+', label: 'مشتری' }] } },
  testimonials: { label: 'نظرات مشتریان', family: 'content', defaults: { title: 'آن‌ها چه گفتند', items: [] } },
  logos: { label: 'لوگوی مشتریان', family: 'content', defaults: { title: 'همکاران ما' } },
  pricing: { label: 'تعرفه‌ها', family: 'content', defaults: { title: 'پلن‌ها', items: [] } },
  faq: { label: 'پرسش‌های متداول', family: 'content', defaults: { title: 'سؤال‌های رایج', items: [] } },
  cta_banner: { label: 'دعوت به اقدام', family: 'content', defaults: { title: 'آماده‌اید؟', cta: 'تماس بگیرید' } },
  gallery: { label: 'گالری تصاویر', family: 'content', defaults: { title: 'تصاویر', images: [] } },
  video: { label: 'ویدیو', family: 'content', defaults: { title: 'ویدیو معرفی' } },
  team: { label: 'تیم ما', family: 'content', defaults: { title: 'تیم ما', members: [] } },
  // Commerce (6)
  product_grid: { label: 'فهرست محصولات', family: 'commerce', defaults: { title: 'محصولات', columns: 3 } },
  product_card: { label: 'کارت محصول', family: 'commerce', defaults: { title: 'محصول', price: '۰', cta: 'افزودن به سبد' } },
  product_detail: { label: 'جزئیات محصول', family: 'commerce', defaults: { title: 'محصول', price: '۰', cta: 'افزودن به سبد' } },
  cart: { label: 'سبد خرید', family: 'commerce', defaults: { title: 'سبد خرید', cta: 'ادامهٔ خرید' } },
  checkout: { label: 'تسویه حساب', family: 'commerce', defaults: { title: 'تسویه حساب', cta: 'پرداخت' } },
  order_success: { label: 'سفارش ثبت شد', family: 'commerce', defaults: { title: 'سفارش شما ثبت شد', cta: 'پیگیری سفارش' } },
  // Auth (6)
  login_password: { label: 'ورود با رمز', family: 'auth', defaults: { title: 'ورود', cta: 'ورود', forgot: 'رمز را فراموش کردم' } },
  login_otp: { label: 'ورود با پیامک', family: 'auth', defaults: { title: 'ورود با پیامک', cta: 'دریافت کد', resend: 'ارسال دوباره' } },
  register: { label: 'ثبت‌نام', family: 'auth', defaults: { title: 'ساخت حساب', cta: 'ثبت‌نام' } },
  forgot_password: { label: 'فراموشی رمز', family: 'auth', defaults: { title: 'بازیابی رمز', cta: 'ارسال کد' } },
  reset_password: { label: 'تعیین رمز تازه', family: 'auth', defaults: { title: 'رمز تازه', cta: 'ذخیره' } },
  verify: { label: 'تأیید حساب', family: 'auth', defaults: { title: 'تأیید شماره', cta: 'تأیید' } },
  // Forms and account (7)
  contact_form: { label: 'فرم تماس', family: 'forms', defaults: { title: 'با ما در تماس باشید', cta: 'ارسال' } },
  newsletter: { label: 'خبرنامه', family: 'forms', defaults: { title: 'عضویت در خبرنامه', cta: 'عضویت' } },
  search_box: { label: 'جست‌وجو', family: 'forms', defaults: { placeholder: 'جست‌وجو…' } },
  file_upload: { label: 'بارگذاری فایل', family: 'forms', defaults: { title: 'فایل را بفرستید' } },
  profile: { label: 'پروفایل', family: 'forms', defaults: { title: 'حساب من' } },
  addresses: { label: 'آدرس‌ها', family: 'forms', defaults: { title: 'آدرس‌های من', cta: 'افزودن آدرس' } },
  orders_list: { label: 'سفارش‌های من', family: 'forms', defaults: { title: 'سفارش‌های من' } },
  // Admin (3)
  admin_dashboard: { label: 'داشبورد مدیریت', family: 'admin', defaults: { title: 'داشبورد', cards: 4 } },
  admin_table: { label: 'جدول مدیریت', family: 'admin', defaults: { title: 'فهرست', columns: 4 } },
  admin_form: { label: 'فرم مدیریت', family: 'admin', defaults: { title: 'افزودن مورد', cta: 'ذخیره' } },
  // System (8)
  page_404: { label: 'صفحهٔ ۴۰۴', family: 'system', defaults: { title: 'صفحه پیدا نشد', cta: 'بازگشت به خانه' } },
  maintenance: { label: 'در دست تعمیر', family: 'system', defaults: { title: 'به‌زودی برمی‌گردیم' } },
  cookie_consent: { label: 'رضایت کوکی', family: 'system', defaults: { text: 'این سایت از کوکی استفاده می‌کند.', cta: 'متوجه شدم' } },
  chat_widget: { label: 'چت شناور', family: 'system', defaults: { title: 'گفت‌وگو با ما' } },
  back_to_top: { label: 'بازگشت به بالا', family: 'system', defaults: { label: 'بالا' } },
  lang_switch: { label: 'تغییر زبان', family: 'system', defaults: {} },
  theme_toggle: { label: 'تغییر روشنایی', family: 'system', defaults: {} },
  whatsapp_float: { label: 'دکمهٔ واتساپ', family: 'system', defaults: { label: 'واتساپ' } }
}

export const MODULE_TYPE_NAMES: readonly string[] = Object.keys(MODULE_TYPES)

/** Families in palette order, with the labels the renderer shows. */
export const MODULE_FAMILIES: ReadonlyArray<{ id: ModuleFamily; label: string }> = [
  { id: 'layout', label: 'چیدمان' },
  { id: 'content', label: 'محتوا' },
  { id: 'commerce', label: 'فروشگاه' },
  { id: 'auth', label: 'ورود و ثبت‌نام' },
  { id: 'forms', label: 'فرم‌ها' },
  { id: 'admin', label: 'مدیریت' },
  { id: 'system', label: 'سیستمی' }
]

const MAX_TEXT = 400
const MAX_PAGES = 24
const MAX_MODULES_PER_PAGE = 24

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasLongText(value: unknown): boolean {
  if (typeof value === 'string') return value.length > MAX_TEXT
  if (Array.isArray(value)) return value.some(hasLongText)
  if (isRecord(value)) return Object.values(value).some(hasLongText)
  return false
}

/**
 * Pages a user can actually walk to from the home page, following edges. The 404 and maintenance pages are exempt:
 * nothing links to them, the router shows them, so "unreachable" there is correct and not a mistake.
 */
export function reachablePages(design: DesignProject): Set<string> {
  const adjacency = new Map<string, string[]>()
  for (const edge of design.edges) {
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to])
  }
  const seen = new Set<string>()
  const queue = ['home']
  while (queue.length > 0) {
    const id = queue.shift()!
    if (seen.has(id) || !design.pages.some((page) => page.id === id)) continue
    seen.add(id)
    for (const next of adjacency.get(id) ?? []) queue.push(next)
  }
  return seen
}

/** True for a page the router serves without a link: the not-found page and the maintenance page. */
export function isSystemOnlyPage(page: DesignPage): boolean {
  return page.path === '/404' || page.modules.some((module) => module.type === 'page_404' || module.type === 'maintenance')
}

/**
 * Everything that can be wrong without a browser. Returned as a list of user-facing sentences (the UI shows them as-is;
 * the build refuses to run on a non-empty list).
 */
export function validateDesign(design: DesignProject): DesignValidation {
  const problems: string[] = []

  if (!design.id || !design.name.trim()) problems.push('نام پروژه خالی است.')
  if (design.pages.length === 0) problems.push('دست‌کم یک صفحه لازم است.')
  if (design.pages.length > MAX_PAGES) problems.push(`تعداد صفحه‌ها از ${MAX_PAGES} بیشتر است.`)

  const pageIds = new Set<string>()
  const paths = new Set<string>()
  for (const page of design.pages) {
    if (pageIds.has(page.id)) problems.push(`شناسهٔ صفحهٔ تکراری: ${page.id}`)
    pageIds.add(page.id)
    if (paths.has(page.path)) problems.push(`مسیر تکراری: ${page.path}`)
    paths.add(page.path)
    if (!page.path.startsWith('/')) problems.push(`مسیر صفحه باید با / شروع شود: ${page.path}`)
    if (page.modules.length > MAX_MODULES_PER_PAGE) {
      problems.push(`صفحهٔ «${page.name}» بیش از ${MAX_MODULES_PER_PAGE} بخش دارد.`)
    }
    const moduleIds = new Set<string>()
    for (const module of page.modules) {
      if (moduleIds.has(module.id)) problems.push(`شناسهٔ بخش تکراری: ${module.id}`)
      moduleIds.add(module.id)
      if (MODULE_TYPES[module.type] === undefined) {
        problems.push(`نوع بخش ناشناخته: ${module.type}`)
      }
      if (hasLongText(module.props)) {
        problems.push(`متن یکی از بخش‌های «${page.name}» بیش از ${MAX_TEXT} کاراکتر است.`)
      }
    }
  }

  if (!design.pages.some((page) => page.path === '/')) {
    problems.push('یک صفحه باید مسیر / داشته باشد (صفحهٔ خانه).')
  }
  if (!design.pages.some((page) => page.id === 'home')) {
    problems.push('شناسهٔ صفحهٔ خانه باید home باشد.')
  }
  for (const edge of design.edges) {
    if (!pageIds.has(edge.from)) problems.push(`اتصال از صفحهٔ ناموجود: ${edge.from}`)
    if (!pageIds.has(edge.to)) problems.push(`اتصال به صفحهٔ ناموجود: ${edge.to}`)
  }
  for (const page of design.pages.filter((entry) => entry.role === 'admin')) {
    const guarded = design.edges.some((edge) => edge.to === page.id)
    if (!guarded) problems.push(`صفحهٔ مدیریتی «${page.name}» از هیچ صفحه‌ای قابل دسترسی نیست.`)
    if (!design.pages.some((entry) => entry.role === 'auth')) {
      problems.push('صفحهٔ مدیریتی بدون صفحهٔ ورود وجود دارد.')
    }
  }

  /*
   * Phase 2: a page nobody can reach is a page the user built and will never see. The 404 and maintenance pages are
   * exempt — the router serves them, nothing links to them.
   */
  const reachable = reachablePages(design)
  for (const page of design.pages) {
    if (page.id === 'home' || isSystemOnlyPage(page)) continue
    if (!reachable.has(page.id)) problems.push(`صفحهٔ «${page.name}» از هیچ صفحه‌ای قابل دسترس نیست.`)
  }

  return { ok: problems.length === 0, problems }
}

/** A short id that is stable enough for a design document and readable in a diff. */
export function designId(prefix: string, index: number): string {
  return `${prefix}-${index}`
}

interface PageBlueprint {
  id: string
  name: string
  path: string
  role: PageRole
  modules: string[]
}

/**
 * The deterministic starting point (no AI call): a user who answers five questions gets a site with pages that make
 * sense for their kind of business and the modules they said they need. This is what makes "no empty canvas" true.
 */
export function suggestDesign(
  answers: DesignAnswers,
  options: { id: string; now: number }
): DesignProject {
  const blueprints: PageBlueprint[] = [
    { id: 'home', name: 'خانه', path: '/', role: 'public', modules: ['navbar', 'hero', 'features', 'cta_banner', 'footer'] }
  ]

  const add = (page: PageBlueprint): void => {
    blueprints.push(page)
  }

  if (answers.type === 'shop') {
    add({ id: 'products', name: 'محصولات', path: '/products', role: 'public', modules: ['navbar', 'product_grid', 'footer'] })
    add({ id: 'product', name: 'جزئیات محصول', path: '/product', role: 'public', modules: ['navbar', 'product_detail', 'footer'] })
    add({ id: 'cart', name: 'سبد خرید', path: '/cart', role: 'public', modules: ['navbar', 'cart', 'footer'] })
    add({ id: 'checkout', name: 'تسویه حساب', path: '/checkout', role: 'public', modules: ['navbar', 'checkout', 'footer'] })
    add({ id: 'order-success', name: 'سفارش ثبت شد', path: '/order-success', role: 'public', modules: ['navbar', 'order_success', 'footer'] })
  } else if (answers.type === 'corporate') {
    add({ id: 'about', name: 'درباره ما', path: '/about', role: 'public', modules: ['navbar', 'about', 'stats', 'footer'] })
    add({ id: 'services', name: 'خدمات', path: '/services', role: 'public', modules: ['navbar', 'features', 'pricing', 'footer'] })
  } else if (answers.type === 'personal') {
    add({ id: 'about', name: 'درباره من', path: '/about', role: 'public', modules: ['navbar', 'about', 'team', 'footer'] })
    add({ id: 'portfolio', name: 'نمونه‌کارها', path: '/portfolio', role: 'public', modules: ['navbar', 'gallery', 'footer'] })
  } else if (answers.type === 'education') {
    add({ id: 'courses', name: 'دوره‌ها', path: '/courses', role: 'public', modules: ['navbar', 'product_grid', 'pricing', 'footer'] })
    add({ id: 'about', name: 'دربارهٔ ما', path: '/about', role: 'public', modules: ['navbar', 'about', 'team', 'footer'] })
  } else if (answers.type === 'clinic') {
    add({ id: 'services', name: 'خدمات', path: '/services', role: 'public', modules: ['navbar', 'features', 'team', 'footer'] })
    add({ id: 'appointment', name: 'نوبت‌دهی', path: '/appointment', role: 'public', modules: ['navbar', 'contact_form', 'footer'] })
  } else {
    add({ id: 'menu', name: 'منو', path: '/menu', role: 'public', modules: ['navbar', 'product_grid', 'footer'] })
    add({ id: 'about', name: 'دربارهٔ ما', path: '/about', role: 'public', modules: ['navbar', 'about', 'footer'] })
  }

  if (answers.needs.includes('contact')) {
    add({ id: 'contact', name: 'تماس با ما', path: '/contact', role: 'public', modules: ['navbar', 'contact_form', 'footer'] })
  }
  if (answers.needs.includes('blog')) {
    add({ id: 'blog', name: 'وبلاگ', path: '/blog', role: 'public', modules: ['navbar', 'features', 'footer'] })
  }
  if (answers.needs.includes('newsletter')) {
    add({ id: 'newsletter', name: 'خبرنامه', path: '/newsletter', role: 'public', modules: ['navbar', 'newsletter', 'footer'] })
  }

  if (answers.needs.includes('otp')) {
    add({ id: 'login', name: 'ورود', path: '/login', role: 'auth', modules: ['navbar', 'login_otp', 'footer'] })
    add({ id: 'forgot', name: 'فراموشی رمز', path: '/forgot', role: 'auth', modules: ['navbar', 'forgot_password', 'footer'] })
  } else if (answers.needs.includes('login')) {
    add({ id: 'login', name: 'ورود', path: '/login', role: 'auth', modules: ['navbar', 'login_password', 'footer'] })
    add({ id: 'forgot', name: 'فراموشی رمز', path: '/forgot', role: 'auth', modules: ['navbar', 'forgot_password', 'footer'] })
  }
  if (answers.needs.includes('admin')) {
    add({ id: 'admin', name: 'مدیریت', path: '/admin', role: 'admin', modules: ['navbar', 'admin_dashboard', 'admin_table', 'footer'] })
  }
  add({ id: 'not-found', name: 'صفحه پیدا نشد', path: '/404', role: 'public', modules: ['navbar', 'page_404', 'footer'] })

  const pages: DesignPage[] = blueprints.map((blueprint, pageIndex) => ({
    id: blueprint.id,
    name: blueprint.name,
    path: blueprint.path,
    role: blueprint.role,
    modules: blueprint.modules.map((type, moduleIndex) => ({
      id: designId(`m${pageIndex + 1}`, moduleIndex + 1),
      type,
      props: { ...(MODULE_TYPES[type]?.defaults ?? {}) }
    }))
  }))

  const edges: DesignEdge[] = pages
    .filter((page) => page.id !== 'home')
    .map((page, index) => ({ id: designId('e', index + 1), from: 'home', to: page.id, trigger: 'click' }))

  if (pages.some((page) => page.id === 'cart') && pages.some((page) => page.id === 'checkout')) {
    edges.push({ id: designId('e', edges.length + 1), from: 'cart', to: 'checkout', trigger: 'submit' })
  }
  if (pages.some((page) => page.id === 'checkout') && pages.some((page) => page.id === 'order-success')) {
    edges.push({ id: designId('e', edges.length + 1), from: 'checkout', to: 'order-success', trigger: 'submit' })
  }
  if (pages.some((page) => page.id === 'login')) {
    edges.push({ id: designId('e', edges.length + 1), from: 'login', to: 'home', trigger: 'submit' })
  }

  return {
    version: 1,
    id: options.id,
    name: answers.siteName.trim() || 'سایت تازه',
    kind: answers.kind,
    type: answers.type,
    locale: answers.locale,
    dir: answers.locale === 'fa' ? 'rtl' : 'ltr',
    theme: { brand: answers.brand, font: answers.locale === 'fa' ? 'vazirmatn' : 'inter' },
    answers,
    pages,
    edges,
    createdAt: options.now,
    updatedAt: options.now
  }
}

/** The five wizard steps, as data, so the UI and the tests cannot disagree about the questions. */
export const WIZARD_STEPS: ReadonlyArray<{
  id: string
  question: string
  hint: string
}> = [
  { id: 'kind', question: 'می‌خواهی چه بسازی؟', hint: 'بیشتر کاربران «وب‌سایت» را انتخاب می‌کنند.' },
  { id: 'type', question: 'کارت چیست؟', hint: 'بر اساس این پاسخ، صفحه‌های پیشنهادی ساخته می‌شود.' },
  { id: 'needs', question: 'به چه چیزهایی نیاز داری؟', hint: 'هر کدام را لازم نداری، خاموش بگذار.' },
  { id: 'look', question: 'ظاهرش چطور باشد؟', hint: 'رنگ را بعداً هم می‌توانی عوض کنی.' },
  { id: 'name', question: 'نام سایت چیست؟', hint: 'همین نام در بالای صفحه‌ها می‌آید.' }
]

export const NEED_OPTIONS: ReadonlyArray<{ id: string; label: string; hint: string }> = [
  { id: 'contact', label: 'فرم تماس', hint: 'صفحهٔ تماس با فرم' },
  { id: 'otp', label: 'ورود با پیامک', hint: 'ورود بدون رمز، با کد پیامکی' },
  { id: 'login', label: 'ورود با رمز', hint: 'ورود با ایمیل و رمز' },
  { id: 'admin', label: 'پنل مدیریت', hint: 'داشبورد و جدول مدیریت' },
  { id: 'blog', label: 'وبلاگ', hint: 'صفحهٔ نوشته‌ها' },
  { id: 'newsletter', label: 'خبرنامه', hint: 'فرم عضویت در خبرنامه' }
]

export const SITE_TYPE_OPTIONS: ReadonlyArray<{ id: DesignSiteType; label: string }> = [
  { id: 'shop', label: 'فروشگاهی' },
  { id: 'corporate', label: 'شرکتی' },
  { id: 'personal', label: 'شخصی' },
  { id: 'education', label: 'آموزشی' },
  { id: 'clinic', label: 'کلینیک' },
  { id: 'restaurant', label: 'رستوران' }
]

export const BRAND_OPTIONS: ReadonlyArray<{ id: string; label: string; color: string }> = [
  { id: 'blue', label: 'آبی', color: '#2563eb' },
  { id: 'green', label: 'سبز', color: '#16a34a' },
  { id: 'orange', label: 'نارنجی', color: '#ea580c' },
  { id: 'violet', label: 'بنفش', color: '#7c3aed' }
]
