import { AlertTriangle, Settings } from 'lucide-react'
import { PROVIDERS } from '@shared/providers'
import { useStore } from '../store'

/**
 * Inline banner shown above the composer when the selected provider has no API
 * key yet, with a shortcut into Settings.
 */
export default function ProviderWarning(): JSX.Element | null {
  const settings = useStore((state) => state.settings)
  const selection = useStore((state) => state.selection)
  const openSettings = useStore((state) => state.openSettings)

  // Custom providers are validated in the Settings section; skip here.
  if (!settings || selection.customProviderId) return null
  if (settings.providers?.[selection.provider]?.hasApiKey) return null

  const label = PROVIDERS[selection.provider]?.label ?? selection.provider

  return (
    <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-2xs text-amber-300">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">
        No API key for <span className="font-medium">{label}</span>. Add one to start chatting.
      </span>
      <button
        type="button"
        onClick={openSettings}
        className="flex items-center gap-1 rounded border border-amber-500/40 px-2 py-0.5 text-amber-200 hover:bg-amber-500/15"
      >
        <Settings className="h-3 w-3" />
        Open Settings
      </button>
    </div>
  )
}
