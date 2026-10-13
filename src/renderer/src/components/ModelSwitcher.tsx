import { Cpu } from 'lucide-react'
import { PROVIDERS, PROVIDER_IDS } from '@shared/providers'
import { decodeSelection, encodeSelection } from '@shared/selection'
import { useStore } from '../store'

const CUSTOM_PREFIX = 'custom::'

/**
 * Grouped provider/model picker shown in the chat header. Lets the user switch
 * the model before each message; the choice is sent with the next run.
 */
export default function ModelSwitcher(): JSX.Element {
  const selection = useStore((state) => state.selection)
  const setSelection = useStore((state) => state.setSelection)
  const customProviders = useStore((state) => state.customProviders)
  const running = useStore((state) => state.running)

  const descriptor = PROVIDERS[selection.provider]
  const modelEntry = descriptor?.models.find((model) => model.id === selection.model)
  const knownModel = modelEntry !== undefined
  const capabilities = modelEntry?.tags.length ? modelEntry.tags.join(', ') : 'general purpose'
  const value = selection.customProviderId
    ? `${CUSTOM_PREFIX}${selection.customProviderId}`
    : encodeSelection(selection.provider, selection.model)

  const onChange = (next: string): void => {
    if (next.startsWith(CUSTOM_PREFIX)) {
      const id = next.slice(CUSTOM_PREFIX.length)
      const custom = customProviders.find((provider) => provider.id === id)
      if (!custom) return
      setSelection({ provider: 'openai', model: custom.model, customProviderId: custom.id })
      return
    }
    const decoded = decodeSelection(next)
    if (!decoded) return
    setSelection({ ...decoded, customProviderId: undefined })
  }

  return (
    <label
      className="flex items-center gap-1 text-2xs text-neutral-400"
      title={`Model used for the next message — capabilities: ${capabilities}`}
    >
      <Cpu className="h-3 w-3 text-neutral-500" />
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={running}
        className="max-w-[16rem] rounded border border-border bg-bg-secondary px-1.5 py-0.5 text-2xs text-neutral-300 outline-none focus:border-accent/50 disabled:opacity-50"
      >
        {!selection.customProviderId && !knownModel && descriptor ? (
          <option value={encodeSelection(selection.provider, selection.model)}>
            {selection.model}
          </option>
        ) : null}
        {customProviders.length > 0 ? (
          <optgroup label="Custom">
            {customProviders.map((provider) => (
              <option key={provider.id} value={`${CUSTOM_PREFIX}${provider.id}`}>
                {provider.label} · {provider.model}
              </option>
            ))}
          </optgroup>
        ) : null}
        {PROVIDER_IDS.map((id) => (
          <optgroup key={id} label={PROVIDERS[id].label}>
            {PROVIDERS[id].models.map((model) => (
              <option key={`${id}::${model.id}`} value={encodeSelection(id, model.id)}>
                {model.tags.length ? `${model.label} · ${model.tags.join(', ')}` : model.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  )
}
