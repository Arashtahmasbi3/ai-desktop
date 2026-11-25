/**
 * Model routing (T20): pick a model from the active provider's own catalogue.
 *
 * The app already knows every model a provider offers, with tags (`cheap`, `fast`, `powerful`, `coding`, `reasoning`).
 * Routing is therefore a choice **inside that list**, never across providers: switching provider would change keys, quota
 * and behaviour, which is not a routing decision. It is also opt-in — silently spending a different model's price on a
 * message is a surprise, so `autoRoute` starts off.
 *
 * Deterministic on purpose: the same task text always yields the same model, because a model choice that wobbles between
 * runs is impossible to reason about after the fact.
 */
export interface RoutableModel {
  id: string
  label?: string
  tags?: readonly string[]
}

export interface RouteDecision {
  model: string
  reason: 'heavy' | 'coding' | 'cheap' | 'default'
}

const HEAVY = /(audit|refactor|migrate|debug|review|architecture|design|analy[sz]e|بازبینی|ممیزی|مهاجرت|بازآرایی|طراحی|تحلیل)/i
const CODING = /(code|bug|test|build|type|compile|fix|کد|تست|باگ|کامپایل|اصلاح)/i

function firstWith(models: readonly RoutableModel[], tag: string): RoutableModel | undefined {
  return models.find((model) => (model.tags ?? []).includes(tag))
}

/**
 * Choose a model: heavy work prefers `powerful` then `reasoning`; ordinary coding prefers `coding` then `fast`; anything
 * else prefers the cheapest thing the provider labels `fast` or `cheap`. Falls back to the first catalogue entry.
 */
export function routeModel(task: string, models: readonly RoutableModel[]): RouteDecision | null {
  const usable = models.filter((model) => typeof model.id === 'string' && model.id !== '')
  if (usable.length === 0) return null

  if (HEAVY.test(task)) {
    const heavy = firstWith(usable, 'powerful') ?? firstWith(usable, 'reasoning')
    if (heavy) return { model: heavy.id, reason: 'heavy' }
  }

  if (CODING.test(task)) {
    const coding = firstWith(usable, 'coding') ?? firstWith(usable, 'fast')
    if (coding) return { model: coding.id, reason: 'coding' }
  }

  const cheap = firstWith(usable, 'cheap') ?? firstWith(usable, 'fast')
  if (cheap) return { model: cheap.id, reason: 'cheap' }

  return { model: usable[0]!.id, reason: 'default' }
}
