import { useTranslation } from 'react-i18next'
import { AlertTriangle, Settings } from 'lucide-react'
import { PROVIDERS } from '@shared/providers'
import { useStore } from '../store'

/**
 * Inline banner shown above the composer when the selected provider has no API
 * key yet, with a shortcut into Settings.
 */
export default function ProviderWarning(): JSX.Element | null {
  const { t } = useTranslation()
  const settings = useStore((state) => state.settings)
  const selection = useStore((state) => state.selection)
  const openSettings = useStore((state) => state.openSettings)

  // Custom providers are validated in the Settings section; skip here.
  if (!settings || selection.customProviderId) return null
  if (settings.providers?.[selection.provider]?.hasApiKey) return null

  const label = PROVIDERS[selection.provider]?.label ?? selection.provider

  return (
    <div className="brutal-banner mx-3 mb-2 flex items-center gap-2 border-warning text-2xs text-warning">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">{t('providerWarning.noKey', { provider: label })}</span>
      <button
        type="button"
        onClick={openSettings}
        className="flex items-center gap-1 rounded border border-warning/40 px-2 py-0.5 text-warning hover:bg-warning/15"
      >
        <Settings className="h-3 w-3" />
        {t('providerWarning.openSettings')}
      </button>
    </div>
  )
}
