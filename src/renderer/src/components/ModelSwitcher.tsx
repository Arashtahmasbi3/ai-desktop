import { Cpu } from 'lucide-react'
import { PROVIDERS, PROVIDER_IDS } from '@shared/providers'
import { decodeSelection, encodeSelection } from '@shared/selection'
import { useStore } from '../store'

/**
 * Grouped provider/model picker shown in the chat header. Lets the user switch
 * the model before each message; the choice is sent with the next run.
 */
export default function ModelSwitcher(): JSX.Element {
  const selection = useStore((state) => state.selection)
  const setSelection = useStore((state) => state.setSelection)
  const running = useStore((state) => state.running)

  const descriptor = PROVIDERS[selection.provider]
  const knownModel = descriptor?.models.some((model) => model.id === selection.model) ?? false

  const onChange = (value: string): void => {
    const decoded = decodeSelection(value)
    if (!decoded) return
    setSelection({ ...decoded, customProviderId: undefined })
  }

  return (
    <label
      className="flex items-center gap-1 text-[11px] text-neutral-400"
      title="Model used for the next message"
    >
      <Cpu className="h-3 w-3 text-neutral-500" />
      <select
        value={encodeSelection(selection.provider, selection.model)}
        onChange={(event) => onChange(event.target.value)}
        disabled={running}
        className="max-w-[16rem] rounded border border-border bg-bg-secondary px-1.5 py-0.5 text-[11px] text-neutral-300 outline-none focus:border-accent/50 disabled:opacity-50"
      >
        {!knownModel && descriptor ? (
          <option value={encodeSelection(selection.provider, selection.model)}>
            {selection.model}
          </option>
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
