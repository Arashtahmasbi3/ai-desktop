import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Check,
  Cpu,
  FolderPlus,
  GitFork,
  KeyRound,
  Languages,
  MapPin,
  Server,
  Settings2,
  Trash2,
  X
} from 'lucide-react'
import { PROVIDERS, PROVIDER_IDS } from '@shared/providers'
import type { ProviderId } from '@shared/types'
import { SUPPORTED_LOCALES } from '../i18n/locale'
import { useStore } from '../store'
import CustomProvidersSection from './CustomProvidersSection'
import GitHubSection from './GitHubSection'

type TabId = 'general' | 'providers' | 'projects' | 'github' | 'vps' | 'advanced'

const TABS: Array<{ id: TabId; labelKey: string; icon: typeof Settings2 }> = [
  { id: 'general', labelKey: 'settings.general', icon: Settings2 },
  { id: 'providers', labelKey: 'settings.providers', icon: KeyRound },
  { id: 'projects', labelKey: 'settings.projects', icon: FolderPlus },
  { id: 'github', labelKey: 'settings.github', icon: GitFork },
  { id: 'vps', labelKey: 'settings.vps', icon: Server },
  { id: 'advanced', labelKey: 'settings.advanced', icon: Cpu }
]

export default function SettingsPanel(): JSX.Element | null {
  const { t } = useTranslation()
  const open = useStore((state) => state.settingsOpen)
  const settings = useStore((state) => state.settings)
  const close = useStore((state) => state.closeSettings)
  const setApiKey = useStore((state) => state.setApiKey)
  const removeApiKey = useStore((state) => state.removeApiKey)
  const setModel = useStore((state) => state.setModel)
  const setActiveProvider = useStore((state) => state.setActiveProvider)
  const addProject = useStore((state) => state.addProject)
  const removeProject = useStore((state) => state.removeProject)
  const updateProjectPath = useStore((state) => state.updateProjectPath)
  const openProject = useStore((state) => state.openProject)
  const locale = useStore((state) => state.locale)
  const setLocale = useStore((state) => state.setLocale)
  const showTokenCount = useStore((state) => state.showTokenCount)
  const setShowTokenCount = useStore((state) => state.setShowTokenCount)
  const setView = useStore((state) => state.setView)

  const [tab, setTab] = useState<TabId>('general')
  const [keys, setKeys] = useState<Partial<Record<ProviderId, string>>>({})
  const [projectName, setProjectName] = useState('')
  const [projectPath, setProjectPath] = useState('')
  const [savingKey, setSavingKey] = useState<ProviderId | null>(null)

  if (!open) return null

  const projects = settings?.projects ?? []

  const saveKey = async (provider: ProviderId): Promise<void> => {
    const value = keys[provider]?.trim()
    if (!value) return
    setSavingKey(provider)
    await setApiKey(provider, value)
    setSavingKey(null)
    setKeys((current) => ({ ...current, [provider]: '' }))
  }

  const browse = async (): Promise<void> => {
    const picked = await window.api.dialog.pickDirectory()
    if (picked) setProjectPath(picked)
  }

  const locate = async (id: string): Promise<void> => {
    const picked = await window.api.dialog.pickDirectory()
    if (picked) await updateProjectPath(id, picked)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div className="flex h-[min(85vh,44rem)] w-[min(58rem,92vw)] flex-col overflow-hidden rounded-2xl border border-border bg-bg-secondary shadow-2xl">
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
            {TABS.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition ${
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
                </div>
              </section>
            ) : null}

            {tab === 'providers' ? (
              <section>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  <KeyRound className="h-3.5 w-3.5" />
                  {t('settings.apiKeys')}
                </h3>
                <div className="flex flex-col gap-3">
                  {PROVIDER_IDS.map((provider) => {
                    const descriptor = PROVIDERS[provider]
                    const view = settings?.providers?.[provider]
                    const active = settings?.activeProvider === provider
                    const model = view?.model ?? descriptor.defaultModel
                    return (
                      <div
                        key={provider}
                        className="rounded-xl border border-border bg-bg-primary p-3"
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <span className="flex items-center gap-2 text-sm font-medium text-neutral-200">
                            {descriptor.label}
                            {view?.hasApiKey ? (
                              <span className="flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-400">
                                <Check className="h-3 w-3" />
                                {t('settings.keySaved')}
                              </span>
                            ) : (
                              <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-neutral-500">
                                {t('settings.noKey')}
                              </span>
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={() => void setActiveProvider(provider)}
                            disabled={active}
                            className={`rounded px-2 py-0.5 text-[11px] ${
                              active
                                ? 'bg-accent/20 text-accent'
                                : 'border border-border text-neutral-400 hover:bg-bg-tertiary'
                            }`}
                          >
                            {active ? t('common.active') : t('common.setActive')}
                          </button>
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type="password"
                            value={keys[provider] ?? ''}
                            onChange={(event) =>
                              setKeys((current) => ({ ...current, [provider]: event.target.value }))
                            }
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') void saveKey(provider)
                            }}
                            placeholder={t('settings.apiKeyPlaceholder')}
                            dir="ltr"
                            autoComplete="off"
                            className="flex-1 rounded border border-border bg-bg-secondary px-2 py-1 font-mono text-xs text-neutral-200 outline-none focus:border-accent/50"
                          />
                          <button
                            type="button"
                            onClick={() => void saveKey(provider)}
                            disabled={!keys[provider]?.trim() || savingKey === provider}
                            className="rounded bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-40"
                          >
                            {t('common.save')}
                          </button>
                          {view?.hasApiKey ? (
                            <button
                              type="button"
                              onClick={() => void removeApiKey(provider)}
                              title={t('common.remove')}
                              aria-label={t('common.remove')}
                              className="rounded border border-border p-1 text-neutral-500 hover:bg-bg-tertiary hover:text-red-400"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </div>

                        <div className="mt-2 flex items-center gap-2">
                          <label className="text-[11px] text-neutral-500">
                            {t('settings.model')}
                          </label>
                          <select
                            value={model}
                            onChange={(event) => void setModel(provider, event.target.value)}
                            className="flex-1 rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-neutral-200 outline-none focus:border-accent/50"
                          >
                            {descriptor.models.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <CustomProvidersSection />
              </section>
            ) : null}

            {tab === 'projects' ? (
              <section>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  <FolderPlus className="h-3.5 w-3.5" />
                  {t('settings.projects')}
                </h3>

                <div className="mb-3 flex items-center gap-2">
                  <input
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                    placeholder={t('settings.projectName')}
                    className="w-36 rounded border border-border bg-bg-primary px-2 py-1 text-xs text-neutral-200 outline-none focus:border-accent/50"
                  />
                  <input
                    value={projectPath}
                    onChange={(event) => setProjectPath(event.target.value)}
                    placeholder={t('settings.projectPath')}
                    dir="ltr"
                    className="flex-1 rounded border border-border bg-bg-primary px-2 py-1 font-mono text-xs text-neutral-200 outline-none focus:border-accent/50"
                  />
                  <button
                    type="button"
                    onClick={() => void browse()}
                    className="rounded border border-border px-2 py-1 text-xs text-neutral-300 hover:bg-bg-tertiary"
                  >
                    {t('common.browse')}
                  </button>
                  <button
                    type="button"
                    disabled={!projectPath.trim()}
                    onClick={() => {
                      void addProject(projectName.trim(), projectPath.trim())
                      setProjectName('')
                      setProjectPath('')
                    }}
                    className="rounded bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-40"
                  >
                    {t('common.add')}
                  </button>
                </div>

                {projects.length === 0 ? (
                  <p className="text-xs text-neutral-600">{t('settings.noProjects')}</p>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-border">
                    {projects.map((project) => (
                      <div
                        key={project.id}
                        className="flex items-center justify-between border-b border-border bg-bg-primary px-3 py-2 text-xs last:border-b-0"
                      >
                        <button
                          type="button"
                          onClick={() => void openProject(project.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="text-neutral-200">{project.name}</span>
                          <span className="ml-2 font-mono text-[10px] text-neutral-500" dir="ltr">
                            {project.path}
                          </span>
                        </button>
                        {project.exists === false ? (
                          <span className="mr-2 flex items-center gap-1 text-[10px] text-amber-400">
                            <AlertTriangle className="h-3 w-3" />
                            {t('settings.missingPath')}
                          </span>
                        ) : null}
                        {project.exists === false ? (
                          <button
                            type="button"
                            onClick={() => void locate(project.id)}
                            className="rounded p-1 text-neutral-500 hover:bg-bg-tertiary hover:text-accent"
                          >
                            <MapPin className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void removeProject(project.id)}
                          title={t('common.remove')}
                          aria-label={t('common.remove')}
                          className="rounded p-1 text-neutral-500 hover:bg-bg-tertiary hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ) : null}

            {tab === 'github' ? <GitHubSection /> : null}

            {tab === 'vps' ? (
              <section className="flex flex-col gap-3">
                <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  <Server className="h-3.5 w-3.5" />
                  {t('settings.vps')}
                </h3>
                <p className="text-xs leading-relaxed text-neutral-400">{t('onboarding.vpsBody')}</p>
                <button
                  type="button"
                  onClick={() => {
                    setView('vps')
                    close()
                  }}
                  className="w-fit rounded bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-hover"
                >
                  {t('sidebar.navVps')}
                </button>
              </section>
            ) : null}

            {tab === 'advanced' ? (
              <section className="flex flex-col gap-3">
                <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  <Cpu className="h-3.5 w-3.5" />
                  {t('settings.advanced')}
                </h3>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-300">
                  <input
                    type="checkbox"
                    checked={showTokenCount}
                    onChange={(event) => setShowTokenCount(event.target.checked)}
                    className="accent-accent"
                  />
                  {t('settings.showTokenCount')}
                </label>
                <p className="text-[11px] text-neutral-600">AI Desktop v2.1.0</p>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
