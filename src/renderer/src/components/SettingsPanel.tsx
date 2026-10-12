import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BarChart3,
  FolderPlus,
  GitFork,
  GitPullRequest,
  Globe,
  KeyRound,
  Languages,
  MemoryStick,
  Plug,
  Server,
  Settings2,
  ShieldCheck,
  Wrench,
  X
} from 'lucide-react'
import { SUPPORTED_LOCALES } from '../i18n/locale'
import { useStore } from '../store'
import ProvidersSection from './ProvidersSection'
import ProjectsSection from './ProjectsSection'
import GitHubSection from './GitHubSection'
import SettingsPlugins from './SettingsPlugins'
import SettingsBrowser from './SettingsBrowser'
import SettingsConnections from './SettingsConnections'
import SettingsCodeReview from './SettingsCodeReview'
import SettingsApproval from './SettingsApproval'
import SettingsMemory from './SettingsMemory'
import SettingsUsage from './SettingsUsage'
import SettingsDeveloper from './SettingsDeveloper'
import SettingsTools from './SettingsTools'
import SettingsAudit from './SettingsAudit'
import Modal from './ui/Modal'

type TabId =
  | 'general'
  | 'providers'
  | 'apikeys'
  | 'plugins'
  | 'browser'
  | 'github'
  | 'projects'
  | 'connections'
  | 'codereview'
  | 'approval'
  | 'memory'
  | 'usage'
  | 'developer'
  | 'tools'
  | 'audit'

interface NavItem {
  id: TabId
  labelKey: string
  icon: typeof Settings2
}

const NAV_GROUPS: Array<{ labelKey?: string; items: NavItem[] }> = [
  { items: [{ id: 'general', labelKey: 'settings.general', icon: Settings2 }] },
  {
    labelKey: 'settings.groupIntegrations',
    items: [
      { id: 'providers', labelKey: 'settings.providers', icon: Server },
      { id: 'plugins', labelKey: 'settings.plugins', icon: Plug },
      { id: 'apikeys', labelKey: 'settings.apiKeys', icon: KeyRound },
      { id: 'browser', labelKey: 'settings.browser', icon: Globe },
      { id: 'github', labelKey: 'settings.github', icon: GitPullRequest }
    ]
  },
  {
    labelKey: 'settings.groupCoding',
    items: [
      { id: 'projects', labelKey: 'settings.projects', icon: FolderPlus },
      { id: 'connections', labelKey: 'settings.connections', icon: Server },
      { id: 'codereview', labelKey: 'settings.codeReview', icon: GitFork },
      { id: 'approval', labelKey: 'settings.approvalMode', icon: ShieldCheck }
    ]
  },
  {
    labelKey: 'settings.groupAdvanced',
    items: [
      { id: 'memory', labelKey: 'settings.memory', icon: MemoryStick },
      { id: 'tools', labelKey: 'settings.tools', icon: Wrench },
      { id: 'audit', labelKey: 'settings.audit', icon: ShieldCheck },
      { id: 'usage', labelKey: 'settings.usage', icon: BarChart3 },
      { id: 'developer', labelKey: 'settings.developer', icon: Wrench }
    ]
  }
]

export default function SettingsPanel(): JSX.Element | null {
  const { t } = useTranslation()
  const open = useStore((state) => state.settingsOpen)
  const close = useStore((state) => state.closeSettings)
  const locale = useStore((state) => state.locale)
  const setLocale = useStore((state) => state.setLocale)
  const showTokenCount = useStore((state) => state.showTokenCount)
  const setShowTokenCount = useStore((state) => state.setShowTokenCount)
  const showContextBeforeSend = useStore((state) => state.showContextBeforeSend)
  const setShowContextBeforeSend = useStore((state) => state.setShowContextBeforeSend)

  const [tab, setTab] = useState<TabId>('general')
  const refreshVps = useStore((state) => state.refreshVps)

  useEffect(() => {
    if (open) void refreshVps()
  }, [open, refreshVps])

  if (!open) return null

  return (
    <Modal
      open
      onClose={close}
      maxWidth="min(58rem, 92vw)"
      maxHeight="min(85vh, 44rem)"
      ariaLabel={t('settings.title')}
    >
      <div className="flex h-[min(85vh,44rem)] max-h-full flex-col overflow-hidden">
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
          <h2 className="text-sm font-semibold text-neutral-100">{t('settings.title')}</h2>
          <button
            type="button"
            onClick={close}
            title={`${t('common.close')} (Esc)`}
            aria-label={t('common.close')}
            className="rounded p-1 text-neutral-500 hover:bg-bg-tertiary hover:text-neutral-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav
            aria-label={t('settings.title')}
            className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-border p-2"
          >
            {NAV_GROUPS.map((group, groupIndex) => (
              <div key={group.labelKey ?? `group-${groupIndex}`} className="flex flex-col gap-0.5">
                {group.labelKey ? (
                  <span className="px-2.5 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-600">
                    {t(group.labelKey)}
                  </span>
                ) : null}
                {group.items.map((item) => {
                  const Icon = item.icon
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTab(item.id)}
                      className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                        tab === item.id
                          ? 'bg-accent/15 text-accent'
                          : 'text-neutral-400 hover:bg-bg-tertiary hover:text-neutral-200'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {t(item.labelKey)}
                    </button>
                  )
                })}
              </div>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {tab === 'general' ? (
              <section className="flex flex-col gap-4">
                <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  <Languages className="h-3.5 w-3.5" />
                  {t('common.language')}
                </h3>
                <div className="rounded-xl border border-border bg-bg-primary p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-neutral-200">{t('settings.languageHint')}</p>
                    </div>
                    <select
                      value={locale}
                      onChange={(event) =>
                        setLocale(event.target.value === 'fa' ? 'fa' : 'en')
                      }
                      aria-label={t('common.language')}
                      className="rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-neutral-200 outline-none focus:border-accent/50"
                    >
                      {SUPPORTED_LOCALES.map((option) => (
                        <option key={option} value={option}>
                          {option === 'fa' ? 'فارسی' : 'English'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-neutral-300">
                    <input
                      type="checkbox"
                      checked={showTokenCount}
                      onChange={(event) => setShowTokenCount(event.target.checked)}
                      className="accent-accent"
                    />
                    {t('settings.showTokenCount')}
                  </label>
                  <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-neutral-300">
                    <input
                      type="checkbox"
                      checked={showContextBeforeSend}
                      onChange={(event) => setShowContextBeforeSend(event.target.checked)}
                      className="accent-accent"
                    />
                    {t('settings.showContextBeforeSend')}
                  </label>
                </div>
              </section>
            ) : null}

            {tab === 'providers' || tab === 'apikeys' ? <ProvidersSection /> : null}

            {tab === 'projects' ? <ProjectsSection /> : null}
            {tab === 'github' ? <GitHubSection /> : null}

            {tab === 'connections' ? <SettingsConnections /> : null}

            {tab === 'plugins' ? <SettingsPlugins /> : null}

            {tab === 'browser' ? <SettingsBrowser /> : null}

            {tab === 'codereview' ? <SettingsCodeReview /> : null}

            {tab === 'approval' ? <SettingsApproval /> : null}

            {tab === 'memory' ? <SettingsMemory /> : null}

            {tab === 'usage' ? <SettingsUsage /> : null}
            {tab === 'tools' ? <SettingsTools /> : null}
            {tab === 'audit' ? <SettingsAudit /> : null}

            {tab === 'developer' ? <SettingsDeveloper /> : null}
          </div>
        </div>
      </div>
    </Modal>
  )
}
