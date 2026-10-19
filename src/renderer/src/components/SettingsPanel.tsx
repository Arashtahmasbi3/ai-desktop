import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BarChart3,
  Blocks,
  FolderPlus,
  GitFork,
  GitPullRequest,
  Globe,
  KeyRound,
  Languages,
  MemoryStick,
  Palette,
  Plug,
  Server,
  Settings2,
  ShieldCheck,
  Wrench,
  X
} from 'lucide-react'
import { SUPPORTED_LOCALES } from '../i18n/locale'
import { THEMES, themeLabelKey } from '../lib/theme'
import ThemeIcon from './ThemeIcon'
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
import SettingsMcp from './SettingsMcp'
import Modal from './ui/Modal'

type TabId =
  | 'general'
  | 'providers'
  | 'apikeys'
  | 'plugins'
  | 'mcp'
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
      // F0-2e: the servers the app may spawn. Its own tab, because it is a list to edit rather
      // than a switch to flip.
      { id: 'mcp', labelKey: 'settings.mcp', icon: Blocks },
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
  const theme = useStore((state) => state.theme)
  const setTheme = useStore((state) => state.setTheme)
  const setLocale = useStore((state) => state.setLocale)
  const showContextBeforeSend = useStore((state) => state.showContextBeforeSend)
  const setShowContextBeforeSend = useStore((state) => state.setShowContextBeforeSend)
  const showJobsPanelAlways = useStore((state) => state.showJobsPanelAlways)
  const setShowJobsPanelAlways = useStore((state) => state.setShowJobsPanelAlways)
  const showRawToolRows = useStore((state) => state.showRawToolRows)
  const setShowRawToolRows = useStore((state) => state.setShowRawToolRows)
  const chatTransferPreference = useStore((state) => state.chatTransferPreference)
  const setChatTransferPreference = useStore((state) => state.setChatTransferPreference)
  const showContextWarning = useStore((state) => state.showContextWarning)
  const setShowContextWarning = useStore((state) => state.setShowContextWarning)

  const requestedTab = useStore((state) => state.settingsTab)
  const [tab, setTab] = useState<TabId>('general')

  /*
   * v4.0: honour a tab the caller asked for. The panel keeps the tab in local state on purpose (it
   * is incidental UI, not app state), so the store hands over a **request** and this effect consumes
   * it — which also means reopening Settings normally lands on General again instead of wherever the
   * last deep link went.
   */
  useEffect(() => {
    if (!requestedTab) return
    // The groups hold the items, so a deep link has to look through them rather than at a flat list.
    const known = NAV_GROUPS.flatMap((group) => group.items).some((item) => item.id === requestedTab)
    if (known) setTab(requestedTab as TabId)
    useStore.setState({ settingsTab: null })
  }, [requestedTab])
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
      closeOnBackdrop
    >
      <div className="flex h-[min(85vh,44rem)] max-h-full flex-col overflow-hidden">
        <div className="flex h-11 shrink-0 items-center justify-between border-b-2 border-fg-strong px-4">
          <h2 className="ui-label text-fg-strong">{t('settings.title')}</h2>
          <button
            type="button"
            onClick={close}
            title={`${t('common.close')} (Esc)`}
            aria-label={t('common.close')}
            className="ui-btn ui-focus p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav
            aria-label={t('settings.title')}
            className="flex w-44 shrink-0 flex-col gap-0.5 border-r-2 border-border p-2"
          >
            {NAV_GROUPS.map((group, groupIndex) => (
              <div key={group.labelKey ?? `group-${groupIndex}`} className="flex flex-col gap-0.5">
                {group.labelKey ? (
                  <span className="ui-label px-2.5 pb-0.5 pt-2">
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
                      data-selected={tab === item.id}
                      className="ui-tab flex items-center gap-2 px-2.5 py-1.5 text-left"
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
                {/*
                  v2.7.0: the theme is a labelled, three-way choice with an explicit
                  hint, so "which theme am I on?" is never a guess. It sits above the
                  language because it is the setting a new user reaches for first.
                */}
                <h3 className="ui-label flex items-center gap-2">
                  <Palette className="h-3.5 w-3.5" />
                  {t('settings.theme')}
                </h3>
                <div className="ui-card p-3">
                  <p className="text-xs text-fg-muted">{t('settings.themeHint')}</p>
                  <div
                    role="radiogroup"
                    aria-label={t('settings.theme')}
                    className="mt-2 grid grid-cols-3 gap-2"
                  >
                    {THEMES.map((option) => {
                      const active = theme === option
                      return (
                        <button
                          key={option}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          data-selected={active}
                          data-testid={`settings-theme-${option}`}
                          onClick={() => setTheme(option)}
                          className="ui-tab flex items-center justify-center gap-2 px-2 py-2"
                        >
                          <ThemeIcon preference={option} className="h-3.5 w-3.5" />
                          {t(themeLabelKey(option))}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <h3 className="ui-label flex items-center gap-2">
                  <Languages className="h-3.5 w-3.5" />
                  {t('common.language')}
                </h3>
                <div className="ui-card p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-fg">{t('settings.languageHint')}</p>
                    </div>
                    <select
                      value={locale}
                      onChange={(event) =>
                        setLocale(event.target.value === 'fa' ? 'fa' : 'en')
                      }
                      aria-label={t('common.language')}
                      className="ui-inset ui-focus px-2 py-1 text-xs text-fg"
                    >
                      {SUPPORTED_LOCALES.map((option) => (
                        <option key={option} value={option}>
                          {option === 'fa' ? 'فارسی' : 'English'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-fg">
                    <input
                      type="checkbox"
                      checked={showContextBeforeSend}
                      onChange={(event) => setShowContextBeforeSend(event.target.checked)}
                      className="accent-accent"
                    />
                    {t('settings.showContextBeforeSend')}
                  </label>
                  <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-fg">
                    <input
                      type="checkbox"
                      checked={showJobsPanelAlways}
                      onChange={(event) => setShowJobsPanelAlways(event.target.checked)}
                      className="accent-accent"
                    />
                    {t('settings.showJobsPanelAlways')}
                  </label>
                  <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-fg">
                    <input
                      type="checkbox"
                      checked={showRawToolRows}
                      onChange={(event) => setShowRawToolRows(event.target.checked)}
                      className="accent-accent"
                    />
                    <span>
                      {t('settings.showRawToolRows')}
                      <span className="mt-0.5 block text-3xs text-fg-muted">
                        {t('settings.showRawToolRowsHint')}
                      </span>
                    </span>
                  </label>
                  <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-fg">
                    <input
                      type="checkbox"
                      checked={showContextWarning}
                      onChange={(event) => setShowContextWarning(event.target.checked)}
                      className="accent-accent"
                    />
                    <span>
                      {t('settings.showContextWarning')}
                      <span className="mt-0.5 block text-3xs text-fg-muted">
                        {t('settings.showContextWarningHint')}
                      </span>
                    </span>
                  </label>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs text-fg">{t('settings.chatOnProjectSwitch')}</p>
                      <p className="mt-0.5 text-3xs text-fg-muted">
                        {t('settings.chatOnProjectSwitchHint')}
                      </p>
                    </div>
                    <select
                      value={chatTransferPreference}
                      onChange={(event) =>
                        setChatTransferPreference(
                          event.target.value as 'ask' | 'link' | 'move' | 'new'
                        )
                      }
                      aria-label={t('settings.chatOnProjectSwitch')}
                      className="ui-inset ui-focus shrink-0 px-2 py-1 text-xs text-fg"
                    >
                      <option value="ask">{t('projectSwitch.ask')}</option>
                      <option value="link">{t('projectSwitch.link')}</option>
                      <option value="move">{t('projectSwitch.move')}</option>
                      <option value="new">{t('projectSwitch.new')}</option>
                    </select>
                  </div>
                </div>
              </section>
            ) : null}

            {tab === 'providers' || tab === 'apikeys' ? <ProvidersSection /> : null}

            {tab === 'projects' ? <ProjectsSection /> : null}
            {tab === 'github' ? <GitHubSection /> : null}

            {tab === 'connections' ? <SettingsConnections /> : null}

            {tab === 'plugins' ? <SettingsPlugins /> : null}

            {tab === 'mcp' ? <SettingsMcp /> : null}

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
