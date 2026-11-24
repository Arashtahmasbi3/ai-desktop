import { describe, expect, it } from 'vitest'
import { suggestDesign, validateDesign } from '../../src/shared/design'
import { composeRecipes, validateRecipe, varyRecipe, type DesignRecipe } from '../../src/shared/design-recipe'

/**
 * Art Board phase 6 — recipes.
 *
 * A custom section must stay inside what the builder can render. These tests are the gate: depth, counts, unknown
 * primitives, raw styles and over-long text are refused, and the three starters are deterministic and valid.
 */
const text = (value: string): DesignRecipe['items'][number] => ({ primitive: 'text', props: { text: value } })

describe('validateRecipe (phase 6)', () => {
  it('accepts every starter it produces', () => {
    for (const recipe of composeRecipes('بخش معرفی تیم با چهار عکس')) {
      expect(validateRecipe(recipe)).toEqual([])
    }
  })

  it('refuses an unknown primitive instead of guessing', () => {
    const recipe: DesignRecipe = { layout: 'stack', gap: 'md', items: [{ primitive: 'video_bg' as never }] }
    expect(validateRecipe(recipe)).toContain('جزء ناشناخته در بخش سفارشی: video_bg')
  })

  it('refuses a raw style or class — the theme owns appearance', () => {
    const recipe = {
      layout: 'stack',
      gap: 'md',
      items: [{ primitive: 'text', props: { text: 'سلام', style: 'color:red' } }]
    } as unknown as DesignRecipe
    expect(validateRecipe(recipe).some((problem) => problem.includes('«style»'))).toBe(true)
  })

  it('refuses more than three levels', () => {
    const deeper: DesignRecipe = {
      layout: 'stack',
      gap: 'md',
      items: [
        {
          primitive: 'stack',
          items: [{ primitive: 'grid', items: [{ primitive: 'card', items: [text('x')] }] }]
        }
      ]
    }
    expect(validateRecipe(deeper).some((problem) => problem.includes('لایه'))).toBe(true)
  })

  it('refuses more than twelve items in one level', () => {
    const many: DesignRecipe = {
      layout: 'stack',
      gap: 'md',
      items: Array.from({ length: 13 }, (_, index) => text(`آیتم ${index}`))
    }
    expect(validateRecipe(many).some((problem) => problem.includes('بیش از 12'))).toBe(true)
  })

  it('refuses a text longer than the cap', () => {
    const long: DesignRecipe = { layout: 'stack', gap: 'md', items: [text('x'.repeat(320))] }
    expect(validateRecipe(long).some((problem) => problem.includes('بیش از 300'))).toBe(true)
  })
})

describe('composeRecipes and varyRecipe (phase 6)', () => {
  it('gives three arrangements of the same content', () => {
    const recipes = composeRecipes('بخش تعرفه‌ها')
    expect(recipes.map((recipe) => recipe.layout)).toEqual(['stack', 'grid-2', 'grid-3'])
    expect(JSON.stringify(recipes[0]!.items)).toBe(JSON.stringify(recipes[1]!.items))
  })

  it('reads a team sentence as cards with avatars, not as a paragraph', () => {
    const [first] = composeRecipes('معرفی تیم با چهار عضو')
    const grid = first!.items.find((item) => item.primitive === 'grid')
    expect(grid?.items).toHaveLength(4)
    expect(JSON.stringify(grid)).toContain('avatar')
  })

  it('cycles layouts without changing content', () => {
    const original: DesignRecipe = { layout: 'stack', gap: 'md', items: [text('a')] }
    expect(varyRecipe(original).layout).toBe('grid-2')
    expect(varyRecipe(varyRecipe(original)).layout).toBe('grid-3')
    expect(varyRecipe(varyRecipe(varyRecipe(original))).layout).toBe('stack')
  })

  it('a bad recipe in a document fails validation, so it can never build', () => {
    const design = suggestDesign(
      { kind: 'website', type: 'corporate', needs: [], brand: 'blue', locale: 'fa', siteName: 'نمونه' },
      { id: 'd-1', now: 1_000 }
    )
    design.pages[0]!.modules.push({
      id: 'bad',
      type: 'custom_section',
      props: { title: 'بد', recipe: { layout: 'stack', gap: 'sm', items: [{ primitive: 'marquee' }] } }
    })
    expect(validateDesign(design).problems.some((problem) => problem.includes('جزء ناشناخته'))).toBe(true)
  })
})
