import { BRAND_OPTIONS, MODULE_TYPES, type DesignModule, type DesignProject } from '@shared/design'

/**
 * The deterministic site generator (phase 3).
 *
 * The contract is the design document; this module turns it into files. There is no model call and no template that can
 * disagree with the board: every module type maps to one of fourteen *shapes*, and a shape is a function of the props.
 * Two builds of the same document produce byte-identical output, which is what makes "what the user sees is what was
 * built" true.
 *
 * Two artifacts come out of one document:
 *  - a Vite + React project (what the user keeps and can host), and
 *  - a single-file `preview.html` (what the user sees immediately, before any npm install).
 */
export type ShapeId =
  | 'navbar'
  | 'footer'
  | 'hero'
  | 'text'
  | 'list'
  | 'cards'
  | 'form'
  | 'auth'
  | 'commerce'
  | 'table'
  | 'media'
  | 'faq'
  | 'pricing'
  | 'system'

/** Every module type of the catalogue, mapped to the shape that renders it. */
export const SHAPES: Readonly<Record<string, ShapeId>> = {
  navbar: 'navbar',
  footer: 'footer',
  breadcrumb: 'text',
  sidebar_admin: 'list',
  section_container: 'text',
  hero: 'hero',
  features: 'list',
  about: 'text',
  stats: 'cards',
  testimonials: 'cards',
  logos: 'cards',
  pricing: 'pricing',
  faq: 'faq',
  cta_banner: 'hero',
  gallery: 'media',
  video: 'media',
  team: 'cards',
  product_grid: 'commerce',
  product_card: 'commerce',
  product_detail: 'commerce',
  cart: 'commerce',
  checkout: 'commerce',
  order_success: 'commerce',
  login_password: 'auth',
  login_otp: 'auth',
  register: 'auth',
  forgot_password: 'auth',
  reset_password: 'auth',
  verify: 'auth',
  contact_form: 'form',
  newsletter: 'form',
  search_box: 'form',
  file_upload: 'form',
  profile: 'form',
  addresses: 'form',
  orders_list: 'table',
  admin_dashboard: 'cards',
  admin_table: 'table',
  admin_form: 'form',
  page_404: 'system',
  maintenance: 'system',
  cookie_consent: 'system',
  chat_widget: 'system',
  back_to_top: 'system',
  lang_switch: 'system',
  theme_toggle: 'system',
  whatsapp_float: 'system'
}

const BRAND_COLORS: Record<string, string> = Object.fromEntries(
  BRAND_OPTIONS.map((option) => [option.id, option.color])
)

/** JSX/HTML-escaped text. Props are user content and are never interpolated raw. */
export function escapeText(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

/** The visual body of one module, as HTML. Shared by the preview and (via JSX-safe markup) the React app. */
export function renderModuleHtml(module: DesignModule): string {
  const shape = SHAPES[module.type] ?? 'text'
  const title = escapeText(str(module.props.title, MODULE_TYPES[module.type]?.label ?? module.type))
  const text = escapeText(str(module.props.text, str(module.props.subtitle)))
  const cta = escapeText(str(module.props.cta, 'ادامه'))
  const items = strings(module.props.items)
  const note = module.notes ? `<p class="note">${escapeText(module.notes)}</p>` : ''

  switch (shape) {
    case 'navbar':
      return `<header class="navbar"><strong>${title}</strong><nav>${items
        .map((item) => `<span>${escapeText(item)}</span>`)
        .join('')}<button class="btn btn-sm">${cta}</button></nav></header>`
    case 'footer':
      return `<footer class="footer">${title}${note}</footer>`
    case 'hero':
      return `<section class="hero"><h1>${title}</h1><p>${text}</p><button class="btn">${cta}</button></section>`
    case 'list':
      return `<section class="block"><h2>${title}</h2><ul>${items
        .map((item) => `<li>${escapeText(item)}</li>`)
        .join('')}</ul>${note}</section>`
    case 'cards':
      return `<section class="block"><h2>${title}</h2><div class="cards">${(items.length > 0 ? items : ['۱', '۲', '۳'])
        .map((item) => `<article class="card"><p>${escapeText(item)}</p></article>`)
        .join('')}</div>${note}</section>`
    case 'pricing':
      return `<section class="block"><h2>${title}</h2><div class="cards">${(items.length > 0 ? items : ['پلن پایه', 'پلن حرفه‌ای'])
        .map((item) => `<article class="card"><h3>${escapeText(item)}</h3><button class="btn">${cta}</button></article>`)
        .join('')}</div></section>`
    case 'faq':
      return `<section class="block"><h2>${title}</h2>${(items.length > 0 ? items : ['پرسش نمونه'])
        .map((item) => `<details><summary>${escapeText(item)}</summary><p>${text}</p></details>`)
        .join('')}</section>`
    case 'form':
      return `<section class="block"><h2>${title}</h2><form class="form"><input placeholder="نام" /><input placeholder="ایمیل" /><textarea placeholder="${text}"></textarea><button class="btn" type="button">${cta}</button></form></section>`
    case 'auth':
      return `<section class="auth"><h2>${title}</h2><form class="form"><input placeholder="شمارهٔ موبایل" /><input placeholder="رمز یا کد" /><button class="btn" type="button">${cta}</button></form>${note}</section>`
    case 'commerce':
      return `<section class="block"><h2>${title}</h2><div class="cards"><article class="card"><div class="thumb"></div><p>${str(module.props.price, '۰')}</p><button class="btn">${cta}</button></article></div>${note}</section>`
    case 'table':
      return `<section class="block"><h2>${title}</h2><table><thead><tr><th>#</th><th>عنوان</th><th>وضعیت</th></tr></thead><tbody><tr><td>۱</td><td>نمونه</td><td>فعال</td></tr></tbody></table></section>`
    case 'media':
      return `<section class="block"><h2>${title}</h2><div class="gallery"><div class="thumb"></div><div class="thumb"></div><div class="thumb"></div></div></section>`
    case 'system':
      return `<section class="system"><strong>${title}</strong><p>${text}</p></section>`
    case 'text':
    default:
      return `<section class="block"><h2>${title}</h2><p>${text}</p>${note}</section>`
  }
}

function pageBody(page: DesignProject['pages'][number]): string {
  return page.modules.map(renderModuleHtml).join('\n')
}

function css(design: DesignProject): string {
  const brand = BRAND_COLORS[design.theme.brand] ?? BRAND_COLORS.blue ?? '#2563eb'
  return `:root{--brand:${brand};--fg:#111827;--muted:#6b7280;--bg:#ffffff;--surface:#f9fafb;--line:#e5e7eb}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,"Vazirmatn",sans-serif;color:var(--fg);background:var(--bg);direction:${design.dir}}
a{color:var(--brand)}
.navbar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 24px;border-bottom:1px solid var(--line)}
.navbar nav{display:flex;align-items:center;gap:16px}
.hero{padding:72px 24px;text-align:center;background:var(--surface)}
.hero h1{font-size:2rem;margin:0 0 12px}
.hero p{color:var(--muted);margin:0 0 20px}
.btn{background:var(--brand);color:#fff;border:0;border-radius:8px;padding:10px 18px;cursor:pointer;font:inherit}
.btn-sm{padding:6px 12px;font-size:.85rem}
.block{padding:40px 24px;border-bottom:1px solid var(--line)}
.block h2{font-size:1.25rem;margin:0 0 16px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.card{border:1px solid var(--line);border-radius:10px;padding:16px}
.auth{max-width:420px;margin:56px auto;padding:24px;border:1px solid var(--line);border-radius:12px}
.form{display:flex;flex-direction:column;gap:10px;margin-top:12px}
.form input,.form textarea{border:1px solid var(--line);border-radius:8px;padding:10px;font:inherit}
table{width:100%;border-collapse:collapse}
th,td{border-bottom:1px solid var(--line);padding:8px;text-align:start}
.gallery{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.thumb{aspect-ratio:4/3;background:var(--surface);border:1px dashed var(--line);border-radius:8px}
.note{color:var(--muted);font-size:.8rem}
.system{padding:16px 24px;background:var(--surface)}
.footer{padding:24px;border-top:1px solid var(--line);color:var(--muted);text-align:center}`
}

/** The standalone preview: one file, no build, no network — what "show me" opens immediately. */
export function renderPreviewHtml(design: DesignProject): string {
  const pages = design.pages
    .filter((page) => page.role !== 'admin')
    .map(
      (page) =>
        `<section class="page" id="${escapeText(page.path)}"><h1 class="page-title">${escapeText(page.name)}</h1>${pageBody(page)}</section>`
    )
    .join('\n')
  return `<!doctype html>
<html lang="${design.locale}" dir="${design.dir}">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeText(design.name)}</title><style>${css(design)}</style></head>
<body>${pages}<footer class="footer">${escapeText(design.name)}</footer></body></html>`
}

function jsxText(value: unknown): string {
  // Inside JSX, braces are expressions; the escaped entity keeps the character and drops the meaning.
  return escapeText(value).replace(/\{/g, '&#123;').replace(/\}/g, '&#125;')
}

function jsxModule(module: DesignModule): string {
  const shape = SHAPES[module.type] ?? 'text'
  const title = jsxText(str(module.props.title, MODULE_TYPES[module.type]?.label ?? module.type))
  const text = jsxText(str(module.props.text, str(module.props.subtitle)))
  const cta = jsxText(str(module.props.cta, 'ادامه'))
  const items = strings(module.props.items).map(jsxText)
  const note = module.notes ? `<p className="note">${jsxText(module.notes)}</p>` : ''

  switch (shape) {
    case 'navbar':
      return `{/* navbar */}<header className="navbar"><strong>${title}</strong><nav>${items
        .map((item) => `<span>${item}</span>`)
        .join('')}<button className="btn btn-sm">${cta}</button></nav></header>`
    case 'footer':
      return `<footer className="footer">${title}${note}</footer>`
    case 'hero':
      return `<section className="hero"><h1>${title}</h1><p>${text}</p><button className="btn">${cta}</button></section>`
    case 'list':
      return `<section className="block"><h2>${title}</h2><ul>${items
        .map((item) => `<li>${item}</li>`)
        .join('')}</ul>${note}</section>`
    case 'cards':
      return `<section className="block"><h2>${title}</h2><div className="cards">${(items.length > 0 ? items : ['۱', '۲', '۳'])
        .map((item) => `<article className="card"><p>${item}</p></article>`)
        .join('')}</div>${note}</section>`
    case 'pricing':
      return `<section className="block"><h2>${title}</h2><div className="cards">${(items.length > 0 ? items : ['پلن پایه', 'پلن حرفه‌ای'])
        .map((item) => `<article className="card"><h3>${item}</h3><button className="btn">${cta}</button></article>`)
        .join('')}</div></section>`
    case 'faq':
      return `<section className="block"><h2>${title}</h2>${(items.length > 0 ? items : ['پرسش نمونه'])
        .map((item) => `<details><summary>${item}</summary><p>${text}</p></details>`)
        .join('')}</section>`
    case 'form':
      return `<section className="block"><h2>${title}</h2><form className="form"><input placeholder="نام" /><input placeholder="ایمیل" /><textarea placeholder="${text}"></textarea><button className="btn" type="button">${cta}</button></form></section>`
    case 'auth':
      return `<section className="auth"><h2>${title}</h2><form className="form"><input placeholder="شمارهٔ موبایل" /><input placeholder="رمز یا کد" /><button className="btn" type="button">${cta}</button></form>${note}</section>`
    case 'commerce':
      return `<section className="block"><h2>${title}</h2><div className="cards"><article className="card"><div className="thumb"></div><p>${jsxText(str(module.props.price, '۰'))}</p><button className="btn">${cta}</button></article></div>${note}</section>`
    case 'table':
      return `<section className="block"><h2>${title}</h2><table><thead><tr><th>#</th><th>عنوان</th><th>وضعیت</th></tr></thead><tbody><tr><td>۱</td><td>نمونه</td><td>فعال</td></tr></tbody></table></section>`
    case 'media':
      return `<section className="block"><h2>${title}</h2><div className="gallery"><div className="thumb"></div><div className="thumb"></div><div className="thumb"></div></div></section>`
    case 'system':
      return `<section className="system"><strong>${title}</strong><p>${text}</p></section>`
    case 'text':
    default:
      return `<section className="block"><h2>${title}</h2><p>${text}</p>${note}</section>`
  }
}

/**
 * The Vite project. Routing is a tiny pathname switch rather than react-router: one fewer dependency for the generated
 * site, and every route the document declares works without a server rewrite.
 */
export function renderSiteFiles(design: DesignProject): Record<string, string> {
  const routes = design.pages
    .map((page) => `  { path: ${JSON.stringify(page.path)}, name: ${JSON.stringify(page.name)}, body: (\n    <>\n      ${page.modules
      .map(jsxModule)
      .join('\n      ')}\n    </>\n  ) }`)
    .join(',\n')

  const app = `import { useMemo } from 'react'
import './styles.css'

const ROUTES = [
${routes}
]

export default function App() {
  const route = useMemo(() => {
    const path = window.location.pathname.replace(/\\/$/, '') || '/'
    return ROUTES.find((entry) => entry.path === path) ?? ROUTES.find((entry) => entry.path === '/404') ?? ROUTES[0]
  }, [])
  return <main>{route?.body}</main>
}
`

  const main = `import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(<App />)
`

  const packageJson = {
    name: design.name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase() || 'site',
    private: true,
    version: '1.0.0',
    type: 'module',
    scripts: { dev: 'vite', build: 'tsc -b && vite build', preview: 'vite preview' },
    dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
    devDependencies: {
      '@types/react': '^18.3.31',
      '@types/react-dom': '^18.3.7',
      '@vitejs/plugin-react': '^5.2.0',
      typescript: '^5.9.3',
      vite: '^7.3.7'
    }
  }

  return {
    'package.json': `${JSON.stringify(packageJson, null, 2)}\n`,
    'index.html': `<!doctype html>\n<html lang="${design.locale}" dir="${design.dir}">\n  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${escapeText(
      design.name
    )}</title></head>\n  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>\n</html>\n`,
    'vite.config.ts': `import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\n\nexport default defineConfig({ plugins: [react()] })\n`,
    'tsconfig.json': `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2020',
          lib: ['ES2020', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          moduleResolution: 'bundler',
          jsx: 'react-jsx',
          strict: true,
          noEmit: true,
          skipLibCheck: true
        },
        include: ['src']
      },
      null,
      2
    )}\n`,
    'src/main.tsx': main,
    'src/App.tsx': app,
    'src/styles.css': css(design),
    'README.md': `# ${escapeText(design.name)}\n\nساخته‌شده با AI Desktop — Art Board.\n\n- اجرا: \`npm install\` سپس \`npm run dev\`\n- ساخت: \`npm run build\`\n\nصفحه‌ها: ${design.pages
      .map((page) => `\`${page.path}\``)
      .join(' · ')}\n`
  }
}
