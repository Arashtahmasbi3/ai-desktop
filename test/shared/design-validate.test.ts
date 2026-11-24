import { describe, expect, it } from 'vitest'
import {
  MODULE_TYPE_NAMES,
  reachablePages,
  suggestDesign,
  validateDesign,
  type DesignAnswers,
  type DesignProject
} from '../../src/shared/design'

/**
 * Art Board phase 0 — the contract.
 *
 * These tests are the ones that make the rest of the phases safe: if the document can be invalid, the builder and the
 * chat will each invent their own idea of valid. Everything here runs without a browser, a file or an LLM.
 */
const answers = (overrides: Partial<DesignAnswers> = {}): DesignAnswers => ({
  kind: 'website',
  type: 'shop',
  needs: ['contact'],
  brand: 'blue',
  locale: 'fa',
  siteName: 'گل‌فروشی',
  ...overrides
})

function build(overrides: Partial<DesignAnswers> = {}): DesignProject {
  return suggestDesign(answers(overrides), { id: 'd-test', now: 1_000 })
}

describe('suggestDesign produces a valid starting point (phase 0)', () => {
  it('a shop gets the commerce flow, not just a home page', () => {
    const design = build({ type: 'shop' })

    expect(design.pages[0]?.path).toBe('/')
    expect(design.pages.map((page) => page.id)).toEqual(
      expect.arrayContaining(['home', 'products', 'cart', 'checkout', 'order-success'])
    )
    expect(validateDesign(design)).toEqual({ ok: true, problems: [] })
  })

  it('asks for OTP and gets an OTP login page, not a password one', () => {
    const design = build({ needs: ['otp'] })
    const login = design.pages.find((page) => page.id === 'login')

    expect(login?.role).toBe('auth')
    expect(login?.modules.some((module) => module.type === 'login_otp')).toBe(true)
  })

  it('adds a guarded admin page only when asked, and always with a login page', () => {
    const withAdmin = build({ needs: ['admin', 'login'] })
    expect(withAdmin.pages.some((page) => page.role === 'admin')).toBe(true)
    expect(withAdmin.pages.some((page) => page.role === 'auth')).toBe(true)
    expect(validateDesign(withAdmin).ok).toBe(true)
  })

  it('never emits an unknown module type', () => {
    for (const type of ['shop', 'corporate', 'personal', 'education', 'clinic', 'restaurant'] as const) {
      const design = build({ type })
      for (const page of design.pages) {
        for (const module of page.modules) {
          expect(MODULE_TYPE_NAMES).toContain(module.type)
        }
      }
      expect(validateDesign(design).ok).toBe(true)
    }
  })

  it('wires every page except home to home, so nothing is orphaned', () => {
    const design = build()
    const reachable = new Set(design.edges.filter((edge) => edge.from === 'home').map((edge) => edge.to))
    const orphans = design.pages.filter((page) => page.id !== 'home' && !reachable.has(page.id))
    expect(orphans).toEqual([])
  })
})

describe('validateDesign refuses what the builder cannot render', () => {
  const mutate = (change: (design: DesignProject) => void): DesignProject => {
    const design = build()
    change(design)
    return design
  }

  it('rejects an unknown module type instead of guessing', () => {
    const design = mutate((entry) => {
      entry.pages[0]!.modules.push({ id: 'm-x', type: 'carousel_3d', props: {} })
    })
    expect(validateDesign(design).problems).toContain('نوع بخش ناشناخته: carousel_3d')
  })

  it('rejects a duplicate path and a duplicate page id', () => {
    const design = mutate((entry) => {
      entry.pages.push({ ...entry.pages[0]!, id: 'home' })
    })
    const problems = validateDesign(design).problems
    expect(problems.some((problem) => problem.includes('شناسهٔ صفحهٔ تکراری'))).toBe(true)
    expect(problems.some((problem) => problem.includes('مسیر تکراری'))).toBe(true)
  })

  it('rejects an edge that points at a page that does not exist', () => {
    const design = mutate((entry) => {
      entry.edges.push({ id: 'e-x', from: 'home', to: 'ghost', trigger: 'click' })
    })
    expect(validateDesign(design).problems).toContain('اتصال به صفحهٔ ناموجود: ghost')
  })

  it('rejects an admin page nothing can reach', () => {
    const design = mutate((entry) => {
      entry.pages.push({ id: 'admin', name: 'مدیریت', path: '/admin', role: 'admin', modules: [] })
    })
    expect(validateDesign(design).problems).toContain('صفحهٔ مدیریتی «مدیریت» از هیچ صفحه‌ای قابل دسترسی نیست.')
  })

  it('requires a home page at /', () => {
    const design = mutate((entry) => {
      entry.pages = entry.pages.filter((page) => page.id !== 'home')
    })
    const problems = validateDesign(design).problems
    expect(problems).toContain('یک صفحه باید مسیر / داشته باشد (صفحهٔ خانه).')
    expect(problems).toContain('شناسهٔ صفحهٔ خانه باید home باشد.')
  })

  it('rejects an over-long text before it reaches the builder', () => {
    const design = mutate((entry) => {
      entry.pages[0]!.modules[0]!.props.title = 'x'.repeat(500)
    })
    expect(validateDesign(design).problems.some((problem) => problem.includes('بیش از'))).toBe(true)
  })

  /*
   * Phase 2: a page nobody can reach is a page the user built and will never see. The 404 page is the exception — the
   * router serves it, nothing links to it — so it must not be reported.
   */
  it('reports a page no edge can reach', () => {
    const design = mutate((entry) => {
      entry.pages.push({ id: 'ghost', name: 'صفحهٔ یتیم', path: '/ghost', role: 'public', modules: [] })
    })
    expect(validateDesign(design).problems).toContain('صفحهٔ «صفحهٔ یتیم» از هیچ صفحه‌ای قابل دسترس نیست.')
  })

  it('does not report the 404 page, which is served without a link', () => {
    const design = build()
    const notFound = design.pages.find((page) => page.path === '/404')
    expect(notFound).toBeDefined()
    expect(validateDesign(design).ok).toBe(true)
  })

  it('counts a page reachable through a chain, not only a direct edge', () => {
    const design = mutate((entry) => {
      entry.pages.push({ id: 'deep', name: 'عمیق', path: '/deep', role: 'public', modules: [] })
      entry.edges.push({ id: 'e-deep', from: 'contact', to: 'deep', trigger: 'click' })
    })
    expect(reachablePages(design).has('deep')).toBe(true)
    expect(validateDesign(design).ok).toBe(true)
  })
})
