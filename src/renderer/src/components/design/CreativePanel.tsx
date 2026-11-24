import { useState } from 'react'
import { composeRecipes, type DesignRecipe } from '@shared/design-recipe'
import { useStore } from '../../store'
import i18n from '../../i18n'

/**
 * The creative tab (phase 6).
 *
 * A user writes one sentence — "a team section with four photos" — and gets three arrangements of real, validated
 * primitives. The starters are deterministic and offline; the chat's version of this arrives in phase 7, and it writes
 * to the same recipe shape, so nothing here has to change then.
 */
export default function CreativePanel({ pageId, pageName }: { pageId: string; pageName: string }): React.JSX.Element {
  const [description, setDescription] = useState('')
  const [suggestions, setSuggestions] = useState<DesignRecipe[]>([])
  const addRecipe = useStore((state) => state.addDesignRecipe)

  const layoutLabel = (recipe: DesignRecipe): string =>
    recipe.layout === 'grid-3'
      ? i18n.t('design.creativeLayout3')
      : recipe.layout === 'grid-2'
        ? i18n.t('design.creativeLayout2')
        : i18n.t('design.creativeLayoutStack')

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4" data-testid="design-creative">
      <h3 className="mb-1 text-sm font-semibold text-fg-strong">{i18n.t('design.creative')}</h3>
      <p className="mb-3 text-3xs text-fg-muted">{i18n.t('design.creativeHint')}</p>

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={i18n.t('design.creativePlaceholder')}
          className="min-w-0 flex-1 rounded border border-border bg-bg-primary px-3 py-2 text-xs text-fg"
          data-testid="design-creative-input"
        />
        <button
          type="button"
          disabled={description.trim().length < 3}
          onClick={() => setSuggestions(composeRecipes(description))}
          data-testid="design-creative-make"
          className="rounded bg-accent-solid px-4 py-2 text-xs text-white disabled:opacity-40"
        >
          {i18n.t('design.creativeMake')}
        </button>
      </div>

      {suggestions.length === 0 ? null : (
        <ul className="flex flex-col gap-2" data-testid="design-creative-suggestions">
          {suggestions.map((recipe, index) => (
            <li
              key={`${recipe.layout}-${index}`}
              className="flex items-center justify-between rounded border border-border px-3 py-2"
              data-testid={`design-suggestion-${index}`}
            >
              <div>
                <p className="text-xs text-fg-strong">{layoutLabel(recipe)}</p>
                <p className="text-3xs text-fg-muted">
                  {i18n.t('design.creativeItemCount', { count: recipe.items.length })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => addRecipe(pageId, recipe, description.trim().slice(0, 60))}
                className="rounded border border-border px-3 py-1 text-3xs text-fg hover:bg-bg-tertiary"
              >
                {i18n.t('design.creativeAdd', { page: pageName })}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
