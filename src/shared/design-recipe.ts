/**
 * Co-design recipes (phase 6).
 *
 * Creative freedom for a non-technical user cannot mean "the model writes HTML": a section has to survive the build, the
 * version diff and the preview. So a custom section is a *recipe* — a small tree of sixteen allowed primitives — and the
 * validator here is the gate. Depth, item counts, unknown primitives and raw styles are refused before anything is
 * stored, which is what keeps "custom" from becoming "unbuildable".
 */
export type Primitive =
  | 'text'
  | 'heading'
  | 'image'
  | 'icon'
  | 'button'
  | 'link'
  | 'list'
  | 'grid'
  | 'stack'
  | 'card'
  | 'divider'
  | 'spacer'
  | 'badge'
  | 'avatar'
  | 'form_field'
  | 'embed'

export interface RecipeItem {
  primitive: Primitive
  props?: Record<string, string | number>
  items?: RecipeItem[]
}

export interface DesignRecipe {
  layout: 'stack' | 'grid-2' | 'grid-3'
  gap: 'sm' | 'md' | 'lg'
  items: RecipeItem[]
}

export const PRIMITIVES: readonly Primitive[] = [
  'text',
  'heading',
  'image',
  'icon',
  'button',
  'link',
  'list',
  'grid',
  'stack',
  'card',
  'divider',
  'spacer',
  'badge',
  'avatar',
  'form_field',
  'embed'
]

export const MAX_DEPTH = 3
export const MAX_ITEMS = 12
export const MAX_TEXT = 300

/** Props a primitive may carry. Anything else — `style`, `class`, `dangerouslySetInnerHTML` — is refused. */
const ALLOWED_PROPS: Readonly<Record<string, readonly string[]>> = {
  text: ['text'],
  heading: ['text', 'level'],
  image: ['src', 'alt'],
  icon: ['name'],
  button: ['label', 'to'],
  link: ['label', 'to'],
  list: [],
  grid: [],
  stack: [],
  card: [],
  divider: [],
  spacer: ['size'],
  badge: ['text'],
  avatar: ['src', 'alt'],
  form_field: ['label', 'placeholder', 'type'],
  embed: ['src']
}

const LAYOUTS: readonly DesignRecipe['layout'][] = ['stack', 'grid-2', 'grid-3']

export function validateRecipe(recipe: unknown): string[] {
  const problems: string[] = []
  if (typeof recipe !== 'object' || recipe === null) return ['بخش سفارشی ساختار درستی ندارد.']

  const entry = recipe as Partial<DesignRecipe>
  if (!entry.layout || !LAYOUTS.includes(entry.layout)) problems.push('چیدمان بخش سفارشی نامعتبر است.')
  if (!Array.isArray(entry.items)) return [...problems, 'بخش سفارشی آیتمی ندارد.']

  const walk = (items: unknown[], depth: number, path: string): void => {
    if (depth > MAX_DEPTH) {
      problems.push(`بخش سفارشی بیش از ${MAX_DEPTH} لایه تو در تو است.`)
      return
    }
    if (items.length > MAX_ITEMS) {
      problems.push(`بخش سفارشی بیش از ${MAX_ITEMS} آیتم در هر لایه دارد.`)
    }
    for (const raw of items) {
      if (typeof raw !== 'object' || raw === null) {
        problems.push(`آیتم نامعتبر در ${path}.`)
        continue
      }
      const item = raw as RecipeItem
      if (!PRIMITIVES.includes(item.primitive)) {
        problems.push(`جزء ناشناخته در بخش سفارشی: ${String(item.primitive)}`)
        continue
      }
      const allowed = ALLOWED_PROPS[item.primitive] ?? []
      for (const key of Object.keys(item.props ?? {})) {
        if (!allowed.includes(key)) {
          problems.push(`ویژگی «${key}» برای ${item.primitive} مجاز نیست.`)
        }
      }
      for (const value of Object.values(item.props ?? {})) {
        if (typeof value === 'string' && value.length > MAX_TEXT) {
          problems.push(`متن یکی از اجزای بخش سفارشی بیش از ${MAX_TEXT} کاراکتر است.`)
        }
      }
      if (item.items) walk(item.items, depth + 1, `${path}.${item.primitive}`)
    }
  }

  walk(entry.items, 1, 'ریشه')
  return problems
}

/** Three deterministic starters from a sentence. The model's version arrives with the chat tools; this one works offline. */
export function composeRecipes(description: string): DesignRecipe[] {
  const title = description.trim().slice(0, 80) || 'بخش تازه'
  const isTeam = /تیم|team|اعضا|نفرات/i.test(description)
  const isPricing = /تعرفه|قیمت|پلن|pricing/i.test(description)
  const isGallery = /گالری|عکس|تصویر|gallery/i.test(description)

  const teamCard = (index: number): RecipeItem => ({
    primitive: 'card',
    items: [
      { primitive: 'avatar', props: { src: `assets/member-${index}.jpg`, alt: `عضو ${index}` } },
      { primitive: 'heading', props: { text: `عضو ${index}`, level: 3 } },
      { primitive: 'text', props: { text: 'سمت' } }
    ]
  })

  const planCard = (name: string): RecipeItem => ({
    primitive: 'card',
    items: [
      { primitive: 'heading', props: { text: name, level: 3 } },
      { primitive: 'text', props: { text: 'توضیح کوتاه' } },
      { primitive: 'button', props: { label: 'انتخاب' } }
    ]
  })

  const photo = (index: number): RecipeItem => ({
    primitive: 'image',
    props: { src: `assets/photo-${index}.jpg`, alt: `تصویر ${index}` }
  })

  let body: RecipeItem[]
  if (isTeam) {
    body = [
      { primitive: 'heading', props: { text: title, level: 2 } },
      { primitive: 'grid', items: [1, 2, 3, 4].map(teamCard) }
    ]
  } else if (isPricing) {
    body = [
      { primitive: 'heading', props: { text: title, level: 2 } },
      { primitive: 'grid', items: ['پلن پایه', 'پلن حرفه‌ای', 'پلن ویژه'].map(planCard) }
    ]
  } else if (isGallery) {
    body = [
      { primitive: 'heading', props: { text: title, level: 2 } },
      { primitive: 'grid', items: [1, 2, 3].map(photo) }
    ]
  } else {
    body = [
      { primitive: 'heading', props: { text: title, level: 2 } },
      { primitive: 'text', props: { text: 'یک توضیح کوتاه دربارهٔ این بخش' } },
      { primitive: 'button', props: { label: 'ادامه' } }
    ]
  }

  return LAYOUTS.map((layout) => ({ layout, gap: 'md' as const, items: body.map((item) => ({ ...item })) }))
}

/** Same content, a different arrangement — what "three more versions" means without an LLM call. */
export function varyRecipe(recipe: DesignRecipe): DesignRecipe {
  const order: DesignRecipe['layout'][] = ['stack', 'grid-2', 'grid-3']
  const next = order[(order.indexOf(recipe.layout) + 1) % order.length]!
  return { ...recipe, layout: next }
}
